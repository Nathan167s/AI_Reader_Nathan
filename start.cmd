@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PAGENEST_NODE=node"
for /d %%D in ("runtime\node-*") do (
  if exist "%%~fD\node.exe" set "PAGENEST_NODE=%%~fD\node.exe"
)

if not exist "node_modules\express" (
  echo 正在安装依赖，请稍候...
  call npm.cmd install --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo 依赖安装失败，请先双击「初始化.cmd」完成环境安装。
    pause
    exit /b 1
  )
)

echo.
echo   页间 PageNest
echo   正在启动 http://127.0.0.1:4173
echo   关闭此窗口即可停止服务。
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:4173"
set PORT=4173
"%PAGENEST_NODE%" server/index.js
pause
