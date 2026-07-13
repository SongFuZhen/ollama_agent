# Ason Agent 启动脚本（Windows / PowerShell）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $root
try {
    node "src/server.js"
} finally {
    Pop-Location
}
