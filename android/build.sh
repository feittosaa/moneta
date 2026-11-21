#!/usr/bin/env bash
# Build local do APK ARM64. Requer SDK Android 35, JDK 17+, zip, ar e tar.
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
"$bt/aapt" package -f -M "$root/android/AndroidManifest.xml" -I "$platform" -S "$work/res" -A "$work/assets" -F "$work/unsigned.apk"
(cd "$work/dex" && zip -q "$work/unsigned.apk" classes.dex)
(cd "$work" && zip -q -9 unsigned.apk lib/arm64-v8a/*.so)
"$bt/zipalign" -f -P 16 4 "$work/unsigned.apk" "$work/aligned.apk"
# Chave de desenvolvimento local. Reutilizada ao atualizar esse APK no mesmo aparelho.
key="$root/android/.local/debug.jks"
mkdir -p "$(dirname "$key")"
if [[ ! -f "$key" ]]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -alias moneta -keyalg RSA -keysize 3072 -validity 3650 \
    -keystore "$key" -storepass android -keypass android -dname 'CN=Moneta local'
fi
"$bt/apksigner" sign --v4-signing-enabled false --ks "$key" --ks-pass pass:android --out "$root/dist/Moneta-Android-arm64.apk" "$work/aligned.apk"
"$bt/apksigner" verify --verbose "$root/dist/Moneta-Android-arm64.apk"
