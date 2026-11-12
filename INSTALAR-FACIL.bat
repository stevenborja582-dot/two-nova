@echo off
setlocal
title Instalar Two-Nova
cd /d "%~dp0"
echo.
echo  Two-Nova (autor: S1even) - instalacion facil
echo  ---------------------------------------------
echo.

rem --- Si este archivo esta junto al .zip (sin descomprimir), descomprime primero ---
if not exist "package.json" (
  if exist "Two-Nova-codigo-0.3.2.zip" (
    echo  Descomprimiendo el codigo...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force -LiteralPath 'Two-Nova-codigo-0.3.2.zip' -DestinationPath 'app'"
    if errorlevel 1 (
      echo  No se pudo descomprimir el zip.
      pause
      exit /b 1
    )
  )
  if exist "app\package.json" cd /d "%~dp0app"
)
if not exist "package.json" (
  echo  No encuentro el codigo de Two-Nova junto a este archivo.
  pause
  exit /b 1
)

rem --- Node.js: si falta, intenta instalarlo con winget ---
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo  Falta Node.js. Voy a instalarlo con winget.
  echo  Si Windows pregunta si permites cambios, pulsa SI.
  where winget >nul 2>nul
  if errorlevel 1 goto sinwinget
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>nul
if errorlevel 1 goto sinnode
goto connode

:sinwinget
echo  No tienes winget. Se abre la pagina de Node.js: instala la version LTS
echo  y vuelve a hacer doble clic en este archivo.
start "" https://nodejs.org/es
pause
exit /b 1

:sinnode
echo  No se pudo instalar Node.js. Instalalo desde https://nodejs.org/es
echo  y vuelve a hacer doble clic en este archivo.
start "" https://nodejs.org/es
pause
exit /b 1

:connode
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo  Tu Node.js es la version %NODEMAJOR% y hace falta la 22 o mas nueva.
  start "" https://nodejs.org/es
  pause
  exit /b 1
)

echo  [1/3] Descargando los componentes - la primera vez tarda unos minutos...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  Fallo la descarga. Revisa tu internet y vuelve a hacer doble clic aqui:
  echo  continua desde donde se quedo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo  Descargando Electron - son unos 100 MB, paciencia...
  node node_modules\electron\install.js
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo  No se encontro electron.exe. Borra la carpeta node_modules y vuelve a intentar.
  pause
  exit /b 1
)

echo  [2/3] Creando el acceso directo en el escritorio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=(Get-Location).Path; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Two-Nova.lnk'); $s.TargetPath=$d+'\node_modules\electron\dist\electron.exe'; $s.Arguments='.'; $s.WorkingDirectory=$d; $s.IconLocation=$d+'\build\icon.ico'; $s.Description='Two-Nova por S1even'; $s.Save()"

echo  [3/3] Abriendo Two-Nova...
start "" "%CD%\node_modules\electron\dist\electron.exe" .
echo.
echo  Listo. La proxima vez abre "Two-Nova" desde el escritorio.
echo  No muevas ni borres esta carpeta: la app corre desde aqui.
timeout /t 8 >nul
