@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ================================================
echo  코코톡 메신저 실행하기
 echo ================================================
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -3 -m pip install -r requirements.txt
    echo.
    echo 브라우저에서 http://localhost:8000 접속
    py -3 app.py
) else (
    python -m pip install -r requirements.txt
    echo.
    echo 브라우저에서 http://localhost:8000 접속
    python app.py
)
pause
