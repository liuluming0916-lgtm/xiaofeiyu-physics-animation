@echo off
chcp 65001 >nul
setlocal
set "LOG=%TEMP%\od-export-probe.log"
echo.
echo   导出探针日志：%LOG%
echo.
if not exist "%LOG%" (
  echo   还没有这个文件。
  echo   请先在打包版里点一次「导出」；不管成功还是崩溃，再双击运行本文件。
  echo.
  pause
  exit /b 0
)
echo   ------- 下面是文件内容 -------
echo.
type "%LOG%"
echo.
echo   -------------------------------
echo   正在资源管理器里选中该文件……
start "" explorer /select,"%LOG%"
echo.
echo   看完把内容（或整个文件）发给小肥鱼即可。
pause
