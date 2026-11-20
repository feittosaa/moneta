#!/usr/bin/env bash
# Gera os instaladores do Moneta em dist/: AppImage para Linux e instalador .exe para Windows.
# Os dois levam o Node.js junto, então quem instala não precisa de nada além do navegador.
# Uso: packaging/build.sh 1.0.0   (precisa de curl, xz, unzip, makensis e sha256sum)
set -euo pipefail
version="${1:?informe a versão, por exemplo 1.0.0}"
version="${version#v}"
node_version=22.22.0
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$root/build"
dist="$root/dist"
rm -rf "$work" "$dist"
mkdir -p "$work/cache" "$dist"

download() {
  local file="$1"
  [ -f "$work/cache/$file" ] || curl -fsSL "https://nodejs.org/dist/v$node_version/$file" -o "$work/cache/$file"
}
download SHASUMS256.txt
download "node-v$node_version-linux-x64.tar.xz"
download "node-v$node_version-win-x64.zip"
(cd "$work/cache" && grep -E " node-v$node_version-(linux-x64\.tar\.xz|win-x64\.zip)$" SHASUMS256.txt | sha256sum -c -)

# Arquivos do app: os mesmos da imagem Docker, mais a licença.
stage() {
  local target="$1"
  mkdir -p "$target"
  cp "$root"/{server.mjs,backend.mjs,finance.mjs,category-rules.mjs,default-rules.json,request-body.mjs,LICENSE} "$target/"
  cp -r "$root/public" "$target/public"
  mkdir -p "$target/docs" && cp -r "$root/docs/guia" "$target/docs/guia"
  printf '{"name":"moneta","version":"%s","type":"module"}\n' "$version" > "$target/package.json"
}

# Linux: AppImage
appdir="$work/Moneta.AppDir"
mkdir -p "$appdir/usr/bin"
tar -xJf "$work/cache/node-v$node_version-linux-x64.tar.xz" -C "$work"
cp "$work/node-v$node_version-linux-x64/bin/node" "$appdir/usr/bin/node"
cp "$work/node-v$node_version-linux-x64/LICENSE" "$appdir/usr/bin/NODE-LICENSE"
stage "$appdir/usr/lib/moneta"
cp "$root/packaging/linux/AppRun" "$appdir/AppRun" && chmod +x "$appdir/AppRun"
sed "s/@VERSION@/$version/" "$root/packaging/linux/moneta.desktop" > "$appdir/moneta.desktop"
cp "$root/public/web-app-manifest-512x512.png" "$appdir/moneta.png"
ln -sf moneta.png "$appdir/.DirIcon"
tool="$work/cache/appimagetool-x86_64.AppImage"
[ -f "$tool" ] || curl -fsSL https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage -o "$tool"
chmod +x "$tool"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 VERSION="$version" "$tool" --no-appstream "$appdir" "$dist/Moneta-x86_64.AppImage"
cp "$root/packaging/linux/install.sh" "$dist/install.sh"

# Windows: instalador NSIS
win="$work/windows"
unzip -q "$work/cache/node-v$node_version-win-x64.zip" -d "$work"
mkdir -p "$win"
cp "$work/node-v$node_version-win-x64/node.exe" "$win/node.exe"
cp "$work/node-v$node_version-win-x64/LICENSE" "$win/NODE-LICENSE.txt"
stage "$win/app"
makensis -V2 -DVERSION="$version" -DSOURCE="$win" -DICON="$root/public/favicon.ico" -DOUTFILE="$dist/Moneta-Setup.exe" "$root/packaging/windows/moneta.nsi"

(cd "$dist" && sha256sum Moneta-x86_64.AppImage Moneta-Setup.exe install.sh > SHA256SUMS.txt)
ls -lh "$dist"
