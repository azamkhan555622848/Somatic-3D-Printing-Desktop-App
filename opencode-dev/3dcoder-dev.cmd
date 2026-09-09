@echo off
rem 3D-Coder dev launcher — isolated config + external-skill kill switches
set "OPENCODE_CONFIG_DIR=C:/Users/azamk/Documents/3D-Coder/opencode-dev/3dcoder-config"
set "OPENCODE_DISABLE_EXTERNAL_SKILLS=1"
set "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1"
set "CODER3D_CAD_PYTHON=C:\Users\azamk\Documents\3D-Coder\cad-mcp\.venv\Scripts\python.exe"
rem MCP servers handed to the Claude chat backend (headless Claude Code)
set "CODER3D_CLAUDE_MCP_CONFIG=%~dp03dcoder-config\claude-subagent-mcp.json"
cd /d "%~dp0"
call bun run dev:desktop
