# Blender escape hatch — install + verify

The Blender MCP server (ahujasid/blender-mcp) gives the agent organic
sculpting/cleanup powers beyond scripted mesh ops. It is wired into
`3dcoder-config/opencode.jsonc` but disabled until Blender exists on this machine.

1. Install Blender 4.x from blender.org (default path is fine).
2. Download `addon.py` from github.com/ahujasid/blender-mcp and install it:
   Blender → Edit → Preferences → Add-ons → Install… → select addon.py → enable
   "Interface: Blender MCP".
3. In Blender's 3D-view sidebar (press N) → BlenderMCP tab → Connect to MCP server.
4. Flip `"enabled": true` on the `blender` entry in
   `opencode-dev/3dcoder-config/opencode.jsonc`; relaunch `3dcoder-dev.cmd`.
5. Verify in-app: the MCP list shows `blender` connected; ask the agent to
   "create a cube in Blender and report the scene objects". Blender must stay
   open while the agent works.

Notes
- `uvx blender-mcp` needs uv on PATH (installed: uv 0.9.7).
- The addon listens on localhost:9876 by default; the MCP server connects to it.
- If the server shows as failed in the app, check that step 3's "Connect to MCP
  server" is active — the addon socket only exists while Blender runs.
