@echo off
REM Ason Agent 启动脚本（Windows / cmd）
pushd "%~dp0"
node "src/server.js"
popd
