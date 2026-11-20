#!/bin/sh
# Instala o Moneta para o usuário atual, sem pedir senha de administrador:
#   curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh
# Para remover (os dados em ~/.local/share/moneta são mantidos):
#   curl -fsSL https://github.com/feittosaa/moneta/releases/latest/download/install.sh | sh -s -- --remover
set -eu
repo=feittosaa/moneta
bin="${XDG_BIN_HOME:-$HOME/.local/bin}"
share="${XDG_DATA_HOME:-$HOME/.local/share}"
desktop="$share/applications/moneta.desktop"
icon="$share/icons/hicolor/512x512/apps/moneta.png"

if [ "${1:-}" = "--remover" ]; then
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
install -m 755 "$tmp" "$bin/moneta"
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

echo "Moneta instalado. Abra pelo menu de aplicativos ou rode: moneta"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Observação: $bin não está no PATH. Use o menu de aplicativos ou rode $bin/moneta." ;;
esac
if ! command -v fusermount3 >/dev/null 2>&1 && ! command -v fusermount >/dev/null 2>&1; then
  echo "Se o Moneta não abrir, instale o pacote fuse3 (ou fuse) da sua distribuição."
fi
