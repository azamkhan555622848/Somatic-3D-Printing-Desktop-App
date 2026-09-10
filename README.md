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
| [Claude Code](https://claude.com/claude-code) or [Codex](https://developers.openai.com/codex/cli) | at least one, signed in - the chat runs on your subscription |
| [Bambu Studio](https://bambulab.com/en/download/studio) | slicing and the Print Gate |
| [Blender](https://www.blender.org/download/) / [FreeCAD](https://www.freecad.org/downloads.php) | optional, for inspecting a model |

Nothing else. Somatic builds its own Python tool environments on first launch,
and fetches its own Python to do it. Windows, Linux, and macOS on both Apple
Silicon and Intel.

## Installing

Download the installer for your platform from
[Releases](https://github.com/azamkhan555622848/Somatic-3D-Printing-Desktop-App/releases),
run it, and open it. The first launch spends a few minutes building the tools
it designs and slices with, about 830 MB, and says what it is doing.

Mesh inspection downloads by itself straight afterwards. Medical imaging is the
large one, roughly 1.3 GB, so it waits until you open a scan and then offers
itself - the same way the Blender and Bambu Studio buttons do.

On macOS the build is not signed yet, so the first open needs
**right-click, then Open**, or Open Anyway under Privacy and Security.

## Working on Somatic

Building it, rather than using it, needs [Bun](https://bun.sh),
[uv](https://docs.astral.sh/uv/) and [Node.js](https://nodejs.org):

```powershell
git clone https://github.com/azamkhan555622848/Somatic-3D-Printing-Desktop-App.git
cd Somatic-3D-Printing-Desktop-App
.\setup.ps1          # Windows
./setup.sh           # Linux
```

Setup creates the five Python environments inside the checkout and writes the
opencode config for them. A development run uses those rather than provisioning
its own, so it costs nothing extra. Then:

```powershell
.\opencode-dev\3dcoder-dev.cmd        # Windows
cd opencode-dev && bun run dev:desktop  # Linux
```

`SOMATIC_FORCE_TOOLCHAIN=1` makes a checkout take the first-run path instead,
which is how to see what a lab member sees.

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
