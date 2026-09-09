#!/usr/bin/env bash
# Somatic first-run setup (Linux and macOS).
#
# Creates the five Python tool-server environments and writes the opencode
# config for THIS machine. The config is generated rather than tracked because
# the servers are launched by absolute path.
#
# Run once after cloning, and again whenever the repository moves.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
packages=(cad-mcp mesh-mcp medimage-mcp print-mcp claude-mcp)

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '\033[31mMissing: %s\033[0m\n  %s\n' "$1" "$2"
    exit 1
  fi
  echo "  found $1"
}

printf '\033[36mSomatic setup\033[0m\n'
echo "Checking prerequisites..."
require bun  "Install Bun from https://bun.sh — it builds and runs the desktop app."
require uv   "Install uv from https://docs.astral.sh/uv/ — it creates the Python tool environments."
require node "Install Node.js from https://nodejs.org — used to generate the config."

# The agents run on the operator's own subscription through their own CLI.
# Neither is required to install, but without one the chat cannot take a turn.
for cli in claude codex; do
  if command -v "$cli" >/dev/null 2>&1; then echo "  found $cli"
  else printf '\033[33m  %s not found - install it and sign in to use that agent\033[0m\n' "$cli"; fi
done

echo
echo "Creating Python tool environments (this takes a few minutes)..."
for pkg in "${packages[@]}"; do
  if [ ! -d "$root/$pkg" ]; then printf '\033[33m  skip %s (not present)\033[0m\n' "$pkg"; continue; fi
  printf '\033[36m  %s\033[0m\n' "$pkg"
  ( cd "$root/$pkg"
    [ -d .venv ] || uv venv --python 3.12 >/dev/null
    uv pip install -q -e . )
done

echo
echo "Installing desktop dependencies..."
( cd "$root/opencode-dev" && bun install )

echo
echo "Writing machine-local config..."
node "$root/scripts/generate-config.mjs"

echo
printf '\033[32mSetup complete.\033[0m\n'
echo "  Start Somatic:  cd opencode-dev && bun run dev:desktop"
echo "  Build it:       cd opencode-dev && bun run --filter @opencode-ai/desktop package:linux"
