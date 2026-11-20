#!/bin/sh
# Instala o Moneta para o usuário atual, sem pedir senha de administrador:
#   curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh
# Para também iniciar o Moneta em segundo plano sempre que você entrar no computador:
#   curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh -s -- --iniciar-com-o-sistema
# Para remover (os dados em ~/.local/share/moneta são mantidos):
#   curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh -s -- --remover
set -eu
repo=feittosaa/moneta
bin="${XDG_BIN_HOME:-$HOME/.local/bin}"
share="${XDG_DATA_HOME:-$HOME/.local/share}"
desktop="$share/applications/moneta.desktop"
icon="$share/icons/hicolor/512x512/apps/moneta.png"
unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/moneta.service"
autostart=false
for option in "$@"; do
  case "$option" in
    --iniciar-com-o-sistema) autostart=true ;;
    --remover) ;;
    *) echo "Opção desconhecida: $option" >&2; exit 1 ;;
  esac
done
has_systemd() { command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }

if [ "${1:-}" = "--remover" ]; then
  if [ -f "$unit" ]; then
    has_systemd && systemctl --user disable --now moneta.service >/dev/null 2>&1 || true
    rm -f "$unit"
    has_systemd && systemctl --user daemon-reload || true
  fi
  rm -f "$bin/moneta" "$desktop" "$icon"
  echo "Moneta removido. Seus dados continuam em $share/moneta."
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64) ;;
  *) echo "Por enquanto o Moneta para Linux existe só para processadores x86_64." >&2; exit 1 ;;
esac
for tool in curl sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Instale o $tool e rode o comando de novo." >&2; exit 1; }
done

url="https://github.com/$repo/releases/latest/download"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
echo "Baixando o Moneta…"
curl -fL --progress-bar "$url/Moneta-x86_64.AppImage" -o "$tmp"
expected="$(curl -fsSL "$url/SHA256SUMS.txt" | awk '$2 == "Moneta-x86_64.AppImage" { print $1 }')"
actual="$(sha256sum "$tmp" | awk '{ print $1 }')"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "O arquivo baixado não confere com a versão publicada. Tente de novo." >&2
  exit 1
fi

mkdir -p "$bin" "$(dirname "$desktop")" "$(dirname "$icon")"
# Troca por renomeação: um Moneta ainda rodando continua com o arquivo antigo até reiniciar,
# em vez de ter o executável sobrescrito por baixo dele.
install -m 755 "$tmp" "$bin/.moneta.novo"
mv -f "$bin/.moneta.novo" "$bin/moneta"
curl -fsSL "https://raw.githubusercontent.com/$repo/main/public/web-app-manifest-512x512.png" -o "$icon" || true
cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Moneta
GenericName=Finanças pessoais
Comment=Painel de finanças pessoais que roda no seu computador
Exec=$bin/moneta
Icon=moneta
Terminal=false
Categories=Office;Finance;
DESKTOP
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$desktop")" >/dev/null 2>&1 || true

# Serviço de usuário: liga o Moneta em segundo plano, na porta 4173, a cada login.
if [ "$autostart" = true ]; then
  if ! has_systemd; then
    echo "Não encontrei o systemd de usuário; o Moneta não vai iniciar sozinho. Abra pelo menu quando quiser usar." >&2
  else
    mkdir -p "$(dirname "$unit")"
    cat > "$unit" <<UNIT
[Unit]
Description=Moneta, painel de finanças pessoais
After=network-online.target

[Service]
ExecStart=$bin/moneta --background
Environment=PORT=4173
Restart=on-failure
RestartSec=10
# Os dados ficam na memória do Moneta: uma queda não pode gravá-la em disco.
LimitCORE=0
UMask=0077

[Install]
WantedBy=default.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable moneta.service >/dev/null 2>&1
    systemctl --user restart moneta.service
    echo "O Moneta agora inicia sozinho, em segundo plano, sempre que você entrar no computador."
    echo "Ele fica em http://127.0.0.1:4173. Para desligar o início automático: systemctl --user disable --now moneta"
  fi
elif [ -f "$unit" ] && has_systemd && systemctl --user is-active --quiet moneta.service; then
  # Atualização com o serviço já instalado: reinicia para usar a versão nova.
  systemctl --user restart moneta.service
fi

echo "Moneta instalado. Abra pelo menu de aplicativos ou rode: moneta"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Observação: $bin não está no PATH. Use o menu de aplicativos ou rode $bin/moneta." ;;
esac
if ! command -v fusermount3 >/dev/null 2>&1 && ! command -v fusermount >/dev/null 2>&1; then
  echo "Se o Moneta não abrir, instale o pacote fuse3 (ou fuse) da sua distribuição."
fi
