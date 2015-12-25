@echo off

rem Run Server
start node app.js
if errorlevel == 1 (
    goto error
)

goto done
:error
pause
:done