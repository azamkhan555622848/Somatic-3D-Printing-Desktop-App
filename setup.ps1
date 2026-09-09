#Requires -Version 5.1
<#
  Somatic first-run setup (Windows).

  Creates the five Python tool-server environments and writes the opencode
  config for THIS machine. The config is generated rather than tracked because
  the servers are launched by absolute path.

  Run once after cloning, and again whenever the repository moves.
#>
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$packages = @("cad-mcp", "mesh-mcp", "medimage-mcp", "print-mcp", "claude-mcp")

function Require-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $name" -ForegroundColor Red
    Write-Host "  $hint"
    exit 1
  }
  Write-Host "  found $name"
}

Write-Host "Somatic setup" -ForegroundColor Cyan
Write-Host "Checking prerequisites..."
Require-Command "bun"  "Install Bun from https://bun.sh — it builds and runs the desktop app."
Require-Command "uv"   "Install uv from https://docs.astral.sh/uv/ — it creates the Python tool environments."
Require-Command "node" "Install Node.js from https://nodejs.org — used to generate the config."

# The agents run on the operator's own subscription through their own CLI.
# Neither is required to install, but without one the chat cannot take a turn.
foreach ($cli in @("claude", "codex")) {
  if (Get-Command $cli -ErrorAction SilentlyContinue) { Write-Host "  found $cli" }
  else { Write-Host "  $cli not found - install it and sign in to use that agent" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Creating Python tool environments (this takes a few minutes)..."
foreach ($pkg in $packages) {
  $dir = Join-Path $root $pkg
  if (-not (Test-Path $dir)) { Write-Host "  skip $pkg (not present)" -ForegroundColor Yellow; continue }
  Write-Host "  $pkg" -ForegroundColor Cyan
  Push-Location $dir
  try {
    if (-not (Test-Path ".venv")) { uv venv --python 3.12 | Out-Null }
    uv pip install -q -e . 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "uv pip install failed in $pkg" }
  } finally { Pop-Location }
}

Write-Host ""
Write-Host "Installing desktop dependencies..."
Push-Location (Join-Path $root "opencode-dev")
try { bun install } finally { Pop-Location }

Write-Host ""
Write-Host "Writing machine-local config..."
node (Join-Path $root "scripts/generate-config.mjs")

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "  Start Somatic:  .\opencode-dev\3dcoder-dev.cmd"
Write-Host "  Build it:       cd opencode-dev; bun run --filter @opencode-ai/desktop package:win"
