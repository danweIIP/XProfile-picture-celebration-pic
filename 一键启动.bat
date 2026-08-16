echo ========================================
echo(
echo 请选择启动版本：
echo   [1] 自动下载头像版本（需要 JSON，文件名以 A 开头）
echo   [2] 自带头像版本（文件名以 B 开头）
echo   [1] 自动下载头像版本（需要JSON，文件名含"篡改猴"）
echo   [2] 自带头像版本（文件名含"自备图片"）
echo(
set /p choice=请输入数字（1 或 2）并按回车: 

if "%choice%"=="1" set PREFIX=A& goto :check
if "%choice%"=="2" set PREFIX=B& goto :check
if "%choice%"=="1" set SEARCH_KEY=篡改猴& goto :check
if "%choice%"=="2" set SEARCH_KEY=自备图片& goto :check
echo 输入无效，请重新选择。
pause
goto :menu

:check
echo(
echo ========================================
echo 正在查找 %PREFIX%*.py ...
echo 正在查找含 "%SEARCH_KEY%" 的 .py 文件...
echo ========================================

:: 使用 PowerShell 精确查找并计数（返回三种结果：ERR_NO_FILE / ERR_MULTI:... / 完整路径）
for /f "delims=" %%i in ('powershell -Command "& { $files = @(Get-ChildItem -Path '%~dp0' -Filter '%PREFIX%*.py' -File); if ($files.Count -eq 0) { Write-Host 'ERR_NO_FILE' } elseif ($files.Count -eq 1) { Write-Host $files[0].FullName } else { Write-Host ('ERR_MULTI:' + ($files.ForEach({$_.Name}) -join ',')) } }"') do set "RESULT=%%i"
:: 使用 PowerShell 按关键词查找（避开 BAT 的字符陷阱）
for /f "delims=" %%i in ('powershell -Command "& { $files = @(Get-ChildItem -Path '%~dp0' -Filter '*.py' -File | Where-Object { $_.Name -like '*%SEARCH_KEY%*' }); if ($files.Count -eq 0) { Write-Host 'ERR_NO_FILE' } elseif ($files.Count -eq 1) { Write-Host $files[0].FullName } else { Write-Host ('ERR_MULTI:' + ($files.ForEach({$_.Name}) -join ',')) } }"') do set "RESULT=%%i"

if "%RESULT%"=="ERR_NO_FILE" (
    echo [错误] 未找到以 %PREFIX% 开头的 .py 文件！
    echo 请确保文件放在本 BAT 同一目录，且文件名以 %PREFIX% 开头。
    echo [错误] 未找到文件名包含 "%SEARCH_KEY%" 的 .py 文件！
    echo 请确保文件放在本 BAT 同一目录下。
pause
exit /b
)

:: 使用字符串切片判断是否多文件（规避管道和特殊字符）
:: 用字符串切片判断是否多文件
if "%RESULT:~0,10%"=="ERR_MULTI:" (
    echo [错误] 找到多个以 %PREFIX% 开头的 .py 文件，请只保留一个：
    echo [错误] 找到多个包含 "%SEARCH_KEY%" 的 .py 文件，请只保留一个：
echo %RESULT:~10%
pause
exit /b
@@ -54,7 +54,7 @@ echo ========================================
echo 正在检测运行环境...
echo ========================================

:: 1. 检测 Python（使用 py -3，不依赖 PATH）
:: 1. 检测 Python（使用 py -3，绕开微软商店）
py -3 --version >nul 2>&1
if errorlevel 1 (
echo [警告] 未找到 Python。
@@ -114,7 +114,7 @@ if /i "!use_mirror!"=="Y" (
)
echo(

:: 4. 安装依赖（优先使用 requirements.txt，若不存在则用预设列表）
:: 4. 安装依赖（优先读取 requirements.txt）
set "REQ_FILE=%~dp0requirements.txt"
if exist "%REQ_FILE%" (
echo 发现 requirements.txt，将安装其中所有依赖。