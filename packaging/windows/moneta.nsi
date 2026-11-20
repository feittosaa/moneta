; Instalador da Moneta para Windows. Instala só para o usuário atual, sem pedir administrador.
; Gerado por packaging/build.sh, que define VERSION, SOURCE, ICON e OUTFILE, e DESKTOP quando há a
; janela nativa (moneta.exe, feita com Tauri): ela abre o painel numa janela própria e mantém o
; servidor escondido, sem janela de terminal, com um ícone na bandeja.
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Moneta"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Moneta"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Moneta ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1046 "ProductName" "Moneta"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador da Moneta"
VIAddVersionKey /LANG=1046 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Licença MIT"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!ifdef DESKTOP
  !define TARGET "$INSTDIR\moneta.exe"
  !define ARGS ""
  !define MUI_WELCOMEPAGE_TEXT "A Moneta é um painel de finanças pessoais que roda no seu computador.$\r$\n$\r$\nEle abre numa janela própria e, ao fechar, continua na bandeja do Windows, sincronizando em segundo plano. Para conectar seus bancos, siga o Guia, no menu da Moneta.$\r$\n$\r$\nClique em Avançar para continuar."
!else
  !define TARGET "$INSTDIR\node.exe"
  !define ARGS '--disable-warning=ExperimentalWarning "$INSTDIR\app\server.mjs" --desktop'
  !define MUI_WELCOMEPAGE_TEXT "A Moneta é um painel de finanças pessoais que roda no seu computador.$\r$\n$\r$\nDepois de instalar, ela abre no navegador. Para conectar seus bancos, siga o Guia, no menu da Moneta.$\r$\n$\r$\nClique em Avançar para continuar."
!endif
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenMoneta
!define MUI_FINISHPAGE_RUN_TEXT "Abrir a Moneta agora"

!insertmacro MUI_PAGE_WELCOME
!ifdef DESKTOP
  !insertmacro MUI_PAGE_COMPONENTS
!endif
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function OpenMoneta
  ExecShell "" "$SMPROGRAMS\Moneta.lnk"
FunctionEnd

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Moneta"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

; Uma Moneta aberta prende os arquivos. Pede ao servidor para gravar o cofre e encerrar; se ele não
; responder, fecha os processos desta instalação.
!macro StopMoneta
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "try { $$k = (Get-Content -Raw $$env:LOCALAPPDATA\Moneta\acesso.key).Trim(); Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Method Post -Uri http://127.0.0.1:4173/api/shutdown -Headers @{Authorization = 'Bearer ' + $$k; Origin = 'http://127.0.0.1:4173'} -ContentType application/json -Body '{}' | Out-Null; Start-Sleep -Seconds 2 } catch {}"`
  Pop $0
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-Process moneta,node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
!macroend

!ifdef DESKTOP
; A janela nativa usa o WebView2, que já vem no Windows 11 e no Windows 10 atualizado.
Function CheckWebView2
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 found
  ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 found
  MessageBox MB_YESNO|MB_ICONEXCLAMATION "A Moneta precisa do Microsoft Edge WebView2, que não foi encontrado neste computador.$\r$\n$\r$\nAbrir a página da Microsoft para instalar? Depois, rode este instalador de novo." IDNO +2
  ExecShell "open" "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
  Abort
  found:
FunctionEnd
!endif

Section "Moneta" SecApp
  SectionIn RO
  !insertmacro StopMoneta
  SetOutPath "$INSTDIR"
  ; Atualização: a versão anterior do app é substituída inteira; os dados ficam em %LOCALAPPDATA%\Moneta.
  RMDir /r "$INSTDIR\app"
  File /r "${SOURCE}\*"
  File "/oname=moneta.ico" "${ICON}"
  CreateShortcut "$SMPROGRAMS\Moneta.lnk" "${TARGET}" '${ARGS}' "$INSTDIR\moneta.ico"
  CreateShortcut "$DESKTOP\Moneta.lnk" "${TARGET}" '${ARGS}' "$INSTDIR\moneta.ico"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Moneta"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Moneta"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\moneta.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  DeleteRegValue HKCU "${RUN_KEY}" "Moneta"
SectionEnd

!ifdef DESKTOP
; Liga a Moneta, só na bandeja, sempre que você entrar no Windows: a sincronização continua sem abrir janela.
Section "Iniciar com o Windows, em segundo plano" SecStartup
  WriteRegStr HKCU "${RUN_KEY}" "Moneta" '"$INSTDIR\moneta.exe" --background'
SectionEnd
!endif

; Atualização pelo próprio app: a Moneta roda este instalador com /S /abrir. Em silêncio, mantém a escolha
; anterior de iniciar com o Windows e, ao terminar, abre a Moneta de novo.
Function .onInit
!ifdef DESKTOP
  Call CheckWebView2
  IfSilent 0 done
  ReadRegStr $0 HKCU "${RUN_KEY}" "Moneta"
  StrCmp $0 "" 0 done
  SectionSetFlags ${SecStartup} 0
  done:
!endif
FunctionEnd

Function .onInstSuccess
  IfSilent 0 done
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/abrir" $1
  IfErrors done
  Call OpenMoneta
  done:
FunctionEnd

Section "Uninstall"
  !insertmacro StopMoneta
  DeleteRegValue HKCU "${RUN_KEY}" "Moneta"
  Delete "$SMPROGRAMS\Moneta.lnk"
  Delete "$DESKTOP\Moneta.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  ; Os dados (banco e credenciais) ficam em %LOCALAPPDATA%\Moneta e não são apagados.
SectionEnd
