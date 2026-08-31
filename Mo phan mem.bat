@echo off
setlocal
cd /d "%~dp0"
title Doc Translator
echo ============================================
echo    DOC TRANSLATOR - Doc va dich tai lieu
echo ============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js.
  echo Vao https://nodejs.org tai ban LTS, cai xong roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\express\package.json" (
  echo Lan dau chay - dang cai thu vien, cho khoang 1-2 phut...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [LOI] Cai thu vien that bai. Kiem tra mang roi thu lai.
    echo.
    pause
    exit /b 1
  )
)
echo Dang khoi dong may chu...
echo.
echo   B1: Mo trinh duyet ^(Chrome / Edge^)
echo   B2: Vao dia chi:  http://localhost:8756
echo   De TAT phan mem: dong cua so mau den nay.
echo.
start "" "http://localhost:8756"
node server.js
echo.
echo === May chu da dung lai ===
pause
