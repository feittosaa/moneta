#!/usr/bin/env bash
# Extrai somente o runtime ARM64 e seus avisos de licença dos pacotes Termux fixados.
set -euo pipefail
dest=${1:?diretório de staging}
mkdir -p "$dest"/{lib/arm64-v8a,assets/runtime,cache}
while read -r hash path; do
  deb="$dest/cache/${path##*/}"
  if [[ ! -f "$deb" ]]; then curl -fLsS "https://packages.termux.dev/apt/termux-main/$path" -o "$deb"; fi
  echo "$hash  $deb" | sha256sum -c -
  member=$(ar t "$deb" | awk '/^data.tar/{print;exit}')
  ar p "$deb" "$member" > "$dest/cache/$member"
  tar xf "$dest/cache/$member" -C "$dest/cache"
done < "$(dirname "$0")/runtime.lock"
prefix="$dest/cache/data/data/com.termux/files/usr"
cp "$prefix/bin/node" "$dest/lib/arm64-v8a/libmoneta_node.so"
for name in libc++_shared libcares libcrypto libicudata libicui18n libicuuc libsqlite3 libssl libz; do
  cp -L "$prefix/lib/$name.so" "$dest/lib/arm64-v8a/"
done
mkdir -p "$dest/assets/runtime/licenses"
cp -r "$prefix/share/doc/." "$dest/assets/runtime/licenses/"
cp -L "$prefix/etc/tls/cert.pem" "$dest/assets/runtime/ca.pem"
