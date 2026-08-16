@echo off
chcp 65001 >nul
title 头像制作器启动器
setlocal enabledelayedexpansion

:menu
cls
echo ========================================
echo         头像制作器启动器
echo ========================================
echo(
echo 请选择启动版本：
echo   [1] 自动下载头像版本（需要JSON，文件名含"篡改猴"）
echo   [2] 自带头像版本（文件名含"自备图片"）
echo(
set /p choice=请输入数字（1 或 2）并按回车: 

if "%choice%"=="1" set SEARCH_KEY=篡改猴& goto :check
if "%choice%"=="2" set SEARCH_KEY=自备图片& goto :check
echo 输入无效，请重新选择。
pause
goto :menu

:check
echo(
echo ========================================
echo 正在查找含 "%SEARCH_KEY%" 的 .py 文件...
echo ========================================

:: 使用 PowerShell 按关键词查找（避开 BAT 的字符陷阱）
for /f "delims=" %%i in ('powershell -Command "& { $files = @(Get-ChildItem -Path '%~dp0' -Filter '*.py' -File | Where-Object { $_.Name -like '*%SEARCH_KEY%*' }); if ($files.Count -eq 0) { Write-Host 'ERR_NO_FILE' } elseif ($files.Count -eq 1) { Write-Host $files[0].FullName } else { Write-Host ('ERR_MULTI:' + ($files.ForEach({$_.Name}) -join ',')) } }"') do set "RESULT=%%i"

if "%RESULT%"=="ERR_NO_FILE" (
    echo [错误] 未找到文件名包含 "%SEARCH_KEY%" 的 .py 文件！
    echo 请确保文件放在本 BAT 同一目录下。
    pause
    exit /b
)

:: 用字符串切片判断是否多文件
if "%RESULT:~0,10%"=="ERR_MULTI:" (
    echo [错误] 找到多个包含 "%SEARCH_KEY%" 的 .py 文件，请只保留一个：
    echo %RESULT:~10%
    pause
    exit /b
)

set "SCRIPT=%RESULT%"
echo 找到脚本：%SCRIPT%
echo(

:: ---------- 环境检测 ----------
echo ========================================
echo 正在检测运行环境...
echo ========================================

:: 1. 检测 Python（使用 py -3，绕开微软商店）
py -3 --version >nul 2>&1
if errorlevel 1 (
    echo [警告] 未找到 Python。
    echo 是否尝试自动安装 Python？（需要联网）
    set /p install_py=请输入 Y（安装）或 N（跳过，手动安装）: 
    if /i "!install_py!"=="Y" (
        echo 正在尝试自动安装 Python...
        winget --version >nul 2>&1
        if errorlevel 1 (
            echo [错误] 未找到 winget，无法自动安装。
            echo 请手动从 https://www.python.org/downloads/ 下载并安装 Python。
            echo 安装时请勾选 "Add Python to PATH"。
            pause
            exit /b
        ) else (
            echo 使用 winget 安装 Python（版本 3.12）...
            winget install Python.Python.3.12 --silent --accept-package-agreements
            if errorlevel 1 (
                echo [错误] 自动安装失败，请手动安装。
                pause
                exit /b
            ) else (
                echo Python 安装成功！即将自动重启启动器...
                timeout /t 2 >nul
                start "" "%~f0"
                exit /b
            )
        )
    ) else (
        echo 请手动安装 Python 后重新运行本脚本。
        echo 下载地址：https://www.python.org/downloads/
        pause
        exit /b
    )
)

:: 2. 检测虚拟环境并决定 pip 参数
set "PIP_USER="
if defined VIRTUAL_ENV (
    echo [提示] 检测到虚拟环境，将不添加 --user 参数。
) else (
    set "PIP_USER=--user"
)

:: 3. 询问镜像源
echo(
echo 是否使用国内镜像（清华源）加速依赖下载？
echo 如果在中国大陆，建议选 Y；若在国外或网络通畅，可选 N 使用官方源。
set /p use_mirror=请输入 Y（使用清华源）或 N（使用官方源）: 

if /i "!use_mirror!"=="Y" (
    set "PIP_OPT=-i https://pypi.tuna.tsinghua.edu.cn/simple"
    echo 将使用清华源安装依赖。
) else (
    set "PIP_OPT="
    echo 将使用官方源（PyPI）安装依赖。
)
echo(

:: 4. 安装依赖（优先读取 requirements.txt）
set "REQ_FILE=%~dp0requirements.txt"
if exist "%REQ_FILE%" (
    echo 发现 requirements.txt，将安装其中所有依赖。
    py -3 -m pip install -r "%REQ_FILE%" !PIP_OPT! !PIP_USER!
    if !errorlevel! neq 0 (
        echo [警告] 安装 requirements.txt 失败，请检查网络或手动安装。
        pause
        exit /b
    )
) else (
    echo 未找到 requirements.txt，将安装基础依赖：requests, Pillow
    py -3 -m pip install requests !PIP_OPT! !PIP_USER!
    if !errorlevel! neq 0 (
        echo [警告] requests 安装失败，请检查网络或手动安装。
        pause
        exit /b
    )
    py -3 -m pip install Pillow !PIP_OPT! !PIP_USER!
    if !errorlevel! neq 0 (
        echo [警告] Pillow 安装失败，请检查网络或手动安装。
        pause
        exit /b
    )
)

echo 所有依赖已就绪。
echo(

:: 5. 运行目标脚本
echo 正在运行脚本：%SCRIPT%
echo ========================================
py -3 "%SCRIPT%"

if !errorlevel! neq 0 (
    echo ========================================
    echo 程序运行出错，请检查上方错误信息。
) else (
    echo ========================================
    echo 程序运行完成。
)
pause
exit /b