#!/usr/bin/env bash
# Build do APK ARM64. Requer SDK Android 35, JDK 17+, zip, ar e tar.
# Release: MONETA_VERSION (por exemplo 1.4.0) define a versão do app, e MONETA_ANDROID_KEYSTORE,
# MONETA_ANDROID_KEYSTORE_PASSWORD, MONETA_ANDROID_KEY_ALIAS e MONETA_ANDROID_KEY_PASSWORD apontam a
# chave de assinatura fixa. Sem elas, o APK sai com a chave de desenvolvimento local.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
sdk=${ANDROID_HOME:?informe o SDK Android}
bt="$sdk/build-tools/35.0.0"
platform="$sdk/platforms/android-35/android.jar"
work=${MONETA_ANDROID_BUILD:-"$root/build/android"}
mkdir -p "$work"/{assets,res/drawable-nodpi,classes,dex} "$root/dist"
"$root/android/runtime.sh" "$work"
cp "$root/public/web-app-manifest-192x192.png" "$work/res/drawable-nodpi/moneta.png"
python3 - "$root" "$work" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
root,work=map(Path,sys.argv[1:])
with ZipFile(work/'assets/app.zip','w',ZIP_DEFLATED) as out:
    for p in [*root.glob('*.mjs'), root/'default-rules.json', root/'LICENSE', *(root/'public').rglob('*'), *(root/'docs/guia').rglob('*')]:
        if p.is_file(): out.write(p,p.relative_to(root))
    out.write(work/'assets/runtime/ca.pem','ca.pem')
PY
"$JAVA_HOME/bin/javac" --release 11 -cp "$platform" -d "$work/classes" "$root/android/src/br/com/moneta/MainActivity.java"
"$JAVA_HOME/bin/jar" cf "$work/app.jar" -C "$work/classes" .
"$bt/d8" --min-api 28 --lib "$platform" --output "$work/dex" "$work/app.jar"
# Versão: 1.4.2 vira versionCode 10402, para que cada release instale por cima da anterior.
manifest="$work/AndroidManifest.xml"
cp "$root/android/AndroidManifest.xml" "$manifest"
if [[ -n "${MONETA_VERSION:-}" ]]; then
  version="${MONETA_VERSION#v}"
  IFS=. read -r major minor patch <<< "$version"
  [[ "$major$minor$patch" =~ ^[0-9]+$ ]] || { echo "Versão inválida: $version" >&2; exit 1; }
  sed -i "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$((major*10000+minor*100+patch))\"/; s/android:versionName=\"[^\"]*\"/android:versionName=\"$version\"/" "$manifest"
fi
"$bt/aapt" package -f -M "$manifest" -I "$platform" -S "$work/res" -A "$work/assets" -F "$work/unsigned.apk"
(cd "$work/dex" && zip -q "$work/unsigned.apk" classes.dex)
(cd "$work" && zip -q -9 unsigned.apk lib/arm64-v8a/*.so)
"$bt/zipalign" -f -P 16 4 "$work/unsigned.apk" "$work/aligned.apk"
if [[ -n "${MONETA_ANDROID_KEYSTORE:-}" ]]; then
  # Chave da release: a mesma em todas as versões, senão o Android recusa a atualização.
  : "${MONETA_ANDROID_KEYSTORE_PASSWORD:?informe a senha da chave de assinatura}"
  export MONETA_ANDROID_KEY_PASSWORD="${MONETA_ANDROID_KEY_PASSWORD:-$MONETA_ANDROID_KEYSTORE_PASSWORD}"
  "$bt/apksigner" sign --v4-signing-enabled false --ks "$MONETA_ANDROID_KEYSTORE" --ks-key-alias "${MONETA_ANDROID_KEY_ALIAS:-moneta}" \
    --ks-pass env:MONETA_ANDROID_KEYSTORE_PASSWORD --key-pass env:MONETA_ANDROID_KEY_PASSWORD \
    --out "$root/dist/Moneta-Android-arm64.apk" "$work/aligned.apk"
else
  # Chave de desenvolvimento local. Reutilizada ao atualizar esse APK no mesmo aparelho.
  key="$root/android/.local/debug.jks"
  mkdir -p "$(dirname "$key")"
  if [[ ! -f "$key" ]]; then
    "$JAVA_HOME/bin/keytool" -genkeypair -alias moneta -keyalg RSA -keysize 3072 -validity 3650 \
      -keystore "$key" -storepass android -keypass android -dname 'CN=Moneta local'
  fi
  "$bt/apksigner" sign --v4-signing-enabled false --ks "$key" --ks-pass pass:android --out "$root/dist/Moneta-Android-arm64.apk" "$work/aligned.apk"
fi
"$bt/apksigner" verify --verbose "$root/dist/Moneta-Android-arm64.apk"
