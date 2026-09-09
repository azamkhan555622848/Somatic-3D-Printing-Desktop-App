# Somatic

A desktop workspace for taking a patient scan to a part that is safe to print.

Somatic covers the whole path in one window: import and segment a CT or MRI,
build the part as parametric CAD, check the mesh, slice it, and pass a **Print
Gate** that refuses a job rather than letting a bad one reach the printer.
Built for a radiology lab running a Bambu Lab X2D.

> **Alpha.** Internal testing only. Nothing produced here is a medical device,
> and no output should be printed and worn without review by someone qualified
> to judge it.

## How the agent works

The chat runs on **your own** Claude Code or Codex subscription. Somatic shells
out to whichever CLI you have installed and signed in, so that vendor's app
stays the authenticated party and turns bill to your account. Somatic holds no
credentials and extracts no tokens.

Pick the agent and model from the header. If a CLI is missing or signed out,
the chat says which one and what to run.

## Requirements

| Need | Why |
|---|---|
| [Bun](https://bun.sh) | builds and runs the desktop app |
| [uv](https://docs.astral.sh/uv/) + Python 3.12 | the five tool servers |
| [Node.js](https://nodejs.org) | generates the machine-local config |
| [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex/cli) | at least one, signed in |
| [Bambu Studio](https://bambulab.com/en/download/studio) | slicing and the Print Gate |
| [Blender](https://www.blender.org/download/) / [FreeCAD](https://www.freecad.org/downloads.php) | optional, for inspecting a model |

Windows and Linux are supported. macOS is not built yet.

## Setup

```powershell
git clone https://github.com/azamkhan555622848/Somatic-3D-Printing-Desktop-App.git
cd Somatic-3D-Printing-Desktop-App
.\setup.ps1          # Windows
./setup.sh           # Linux
```

Setup creates the five Python environments and writes the opencode config for
your machine. That config is generated, not tracked, because the tool servers
are launched by absolute path — re-run setup if you move the repository.

Then start it:

```powershell
.\opencode-dev\3dcoder-dev.cmd        # Windows
cd opencode-dev && bun run dev:desktop  # Linux
```

## The five tool servers

| Server | Does |
|---|---|
| `coder3d-medimage` | DICOM to NIfTI, segmentation, meshing |
| `coder3d-cad` | parametric CAD (build123d), exports STL/GLB/3MF/STEP |
| `coder3d-mesh` | inspection, repair, watertight checks |
| `coder3d-print` | slicing through Bambu Studio, print settings, and the Print Gate |
| `coder3d-claude` | routes design work to the agent |

## Print settings

Ask for an outcome and the agent changes the slice for you, without anyone
opening Bambu Studio: "use less filament", "make it stronger", "turn supports
off". It edits only the density-related settings, so the printer, filament and
process stay exactly what the lab chose in the template.

How thin a part may be made depends on what it is for. A display or teaching
model can be hollowed out; a prosthetic, orthosis, surgical guide or other
load-bearing part has floors it will not go under, and asking for less is
refused with the reason rather than quietly rounded up. The Print Gate still
runs on the result.

## Patient data

None is in this repository, and none should be added. Case folders, DICOM,
NIfTI, generated meshes, sliced jobs and provenance are all ignored by git —
only the synthetic `demo` case is tracked. Keep scans in the lab, and use
anonymised data in any shared workspace.

## Built on

A fork of [opencode](https://opencode.ai), which provides the editor shell,
session handling and MCP runtime.
