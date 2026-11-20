; Instalador do Moneta para Windows. Instala só para o usuário atual, sem pedir administrador.
; Gerado por packaging/build.sh, que define VERSION, SOURCE, ICON e OUTFILE.
Unicode true
!include "MUI2.nsh"

Name "Moneta"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Moneta"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Moneta ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1046 "ProductName" "Moneta"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do Moneta"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Licença MIT"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define ARGS '--disable-warning=ExperimentalWarning "$INSTDIR\app\server.mjs" --desktop'
!define MUI_WELCOMEPAGE_TEXT "O Moneta é um painel de finanças pessoais que roda no seu computador.$\r$\n$\r$\nDepois de instalar, ele abre no navegador. Para conectar seus bancos, siga o Guia, no menu do Moneta.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenMoneta
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Moneta agora"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function OpenMoneta
  ExecShell "" "$SMPROGRAMS\Moneta.lnk"
FunctionEnd

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Moneta"

Section "Moneta"
  SetOutPath "$INSTDIR"
  ; Atualização: a versão anterior do app é substituída inteira; os dados ficam em %LOCALAPPDATA%\Moneta.
  RMDir /r "$INSTDIR\app"
  File /r "${SOURCE}\*"
  File "/oname=moneta.ico" "${ICON}"
  CreateShortcut "$SMPROGRAMS\Moneta.lnk" "$INSTDIR\node.exe" '${ARGS}' "$INSTDIR\moneta.ico"
  CreateShortcut "$DESKTOP\Moneta.lnk" "$INSTDIR\node.exe" '${ARGS}' "$INSTDIR\moneta.ico"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Moneta"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Moneta"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\moneta.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Moneta.lnk"
  Delete "$DESKTOP\Moneta.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Os dados (banco e credenciais) ficam em %LOCALAPPDATA%\Moneta e não são apagados.
SectionEnd
