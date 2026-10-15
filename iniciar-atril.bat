@echo off
rem Abre Atril desde esta carpeta en http://localhost:8080
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  python -m http.server 8080
  goto :eof
)
where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080
  npx --yes serve -l 8080 .
  goto :eof
)
echo No encontre Python ni Node.js. Instala uno de los dos (python.org o nodejs.org) y vuelve a intentarlo.
pause
