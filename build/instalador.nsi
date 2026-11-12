; Instalador de Two-Nova (autor: S1even). Se instala solo para tu usuario: no pide administrador.
Unicode true
!define APP_NAME "Two-Nova"
!define APP_EXE "Two-Nova.exe"
!define APP_VERSION "0.3.2"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Two-Nova"

Name "${APP_NAME}"
OutFile "../dist/Two-Nova-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Two-Nova"
InstallDirRegKey HKCU "Software\Two-Nova" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Two-Nova por S1even"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar Two-Nova"
!define MUI_WELCOMEPAGE_TEXT "Two-Nova es una isla en tu pantalla que vigila a Claude Code y conversa contigo.$\r$\n$\r$\nSe instala solo para tu usuario, sin permisos de administrador.$\r$\n$\r$\nHecho por S1even."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir Two-Nova ahora"

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

VIProductVersion "0.3.2.0"
VIAddVersionKey /LANG=${LANG_SPANISH} "ProductName" "Two-Nova"
VIAddVersionKey /LANG=${LANG_SPANISH} "CompanyName" "S1even"
VIAddVersionKey /LANG=${LANG_SPANISH} "LegalCopyright" "© 2026 S1even"
VIAddVersionKey /LANG=${LANG_SPANISH} "FileDescription" "Instalador de Two-Nova"
VIAddVersionKey /LANG=${LANG_SPANISH} "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_SPANISH} "ProductVersion" "${APP_VERSION}"

; La carpeta de instalación debe terminar en "Two-Nova" para que desinstalar nunca borre otra cosa.
Function DirLeave
  StrCpy $0 "$INSTDIR" 8 -8
  ${If} $0 != "Two-Nova"
    StrCpy $INSTDIR "$INSTDIR\Two-Nova"
  ${EndIf}
FunctionEnd

Section "Instalar"
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0
  Sleep 400
  SetOutPath "$INSTDIR"
  File /r "../dist/win-unpacked/*.*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  CreateDirectory "$SMPROGRAMS\Two-Nova"
  CreateShortCut "$SMPROGRAMS\Two-Nova\Two-Nova.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\Two-Nova\Desinstalar Two-Nova.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortCut "$DESKTOP\Two-Nova.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "Software\Two-Nova" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Two-Nova"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "S1even"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Seguridad: solo se borra si la carpeta se llama Two-Nova.
  StrCpy $0 "$INSTDIR" 8 -8
  ${If} $0 != "Two-Nova"
    MessageBox MB_OK|MB_ICONSTOP "Por seguridad no borro esta carpeta porque no se llama Two-Nova: $INSTDIR"
    Abort
  ${EndIf}
  nsExec::Exec 'taskkill /F /IM "${APP_EXE}"'
  Pop $0
  Sleep 400
  Delete "$DESKTOP\Two-Nova.lnk"
  RMDir /r "$SMPROGRAMS\Two-Nova"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Two-Nova"
  ; Inicio con Windows (si lo activaste en la app)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Two-Nova"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Two-Nova"
  IfSilent +3
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también tus datos de Two-Nova (personalidades, ajustes y la clave cifrada)?" IDNO +2
  RMDir /r "$APPDATA\Two-Nova"
SectionEnd
