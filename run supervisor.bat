@echo off

rem Run the application
start supervisor --extensions "js|html" -w "./app.js" app.js
if errorlevel == 1 (
    goto error
)

goto done
:error
pause
:done