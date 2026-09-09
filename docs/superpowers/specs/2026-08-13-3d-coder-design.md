# 3D-Coder — Design Spec

**Date:** 2026-08-13
**Status:** Approved (Azam, 2026-08-13)
**Home:** `Documents/3D-Coder/` (opencode fork already cloned at `3D-Coder/opencode-dev/`)

## 1. What this is

3D-Coder is a Claude-Desktop-style app for **vibe-designing accurate, printable 3D models in a medical radiology lab**: anatomical models segmented from patient CT/MRI, patient-matched prosthetic parts, and generic lab hardware. It is the fourth opencode fork (after Paperino, TISS Arena, CutAI) and reuses their proven chassis: chat on the left, an always-on Preview panel on the right, project-scoped MCP servers, skills, and hard quality gates.

The one-sentence promise: *drop a CT export into a case, say "print me the liver with the tumor in red," and get a dimensionally verified `.gcode.3mf` for the lab's Bambu X2D — with a QA report a radiologist can trust.*

### Decisions (from brainstorming, 2026-08-13)

| Decision | Choice |
|---|---|
| Output scope | Anatomical models from scans, prosthetics / patient-matched parts, generic lab hardware. **Surgical guides are out of scope.** |
| Imaging input | Exported DICOM folders dropped into the case workspace. **No PACS integration.** |
| Printer | Bambu Lab **X2D** (FDM): dual nozzle (direct-drive main + Bowden auxiliary for supports/secondary material), build volume 256×256×260 mm (235.5×256×256 dual-nozzle mode), AMS 2 Pro (expandable to 25 colors), 300 °C nozzle / 120 °C bed / 65 °C heated chamber, WiFi + Ethernet. |
| Segmentation compute | Pluggable chain: local NVIDIA GPU if present → lab GPU server (same engine behind a small FastAPI, de-identified NIfTI only) → CPU "fast" (3 mm) mode with a warning. |
| Architecture approach | **C — headless code spine + GUI escape hatches.** Every case flows through scripted, gated, provenance-logged pipeline steps (custom MCP servers over Python libraries). Blender and FreeCAD attach as optional power tools. The preview panel is the app's own viewer, never dependent on external apps being open. |

### Why approach C (rejected alternatives)

- **A — remote-control the GUI apps (Blender/FreeCAD/Slicer MCP only):** brittle stateful sessions, three heavyweight apps must run, results irreproducible, gates unenforceable. Rejected as the spine.
- **B — pure headless:** loses the human "grab a vertex" path that organic medical geometry sometimes needs. Kept as the spine but not the whole story.
- **C** gives medical-grade reproducibility by default (the script is the provenance record) plus artistic escape hatches.

## 2. Chassis

- Fork boot from `3D-Coder/opencode-dev`, minimal rebrand in P1 (working title "3D-Coder"; full icon/installer rebrand later, InteJer rcedit pattern).
- Launcher `3dcoder-dev.cmd` sets `OPENCODE_CONFIG=3dcoder-mcp.jsonc` so 3D-Coder's MCP servers stay isolated from InteJer's and CutAI's (shared-global-config lesson).
- Known Windows gotchas inherited from CutAI: no `{env:PATH}` interpolation in config, `.env` does not reach the sidecar, orphan sidecar processes lock the binary on restart.
- **Case workspaces**: one folder per patient case or design job under `cases/`. The Preview panel file-watches the active case and hot-reloads whatever artifact the agent last wrote (Paperino PDF-refresh pattern), auto-switching to the matching view tab.

## 3. Preview panel — three views

Tabs mirror the pipeline (image → design → print); the active tab doubles as case progress.

### 3.1 Medical View (NiiVue)

Rendered with **NiiVue** (MIT, WebGL2, purpose-built for medical volumes):

- Tri-planar CT/MRI slices + 3D volume rendering.
- Radiology window/level presets: bone, soft tissue, lung.
- Segmentation masks as colored overlays with an anatomical-label legend from TotalSegmentator structure names.
- R/L/A/P/S/I orientation labels derived from the DICOM/NIfTI affine.
- Clip planes.
- Input is always NIfTI (`medimage-mcp` converts DICOM at import via dcm2niix), so NiiVue never parses DICOM directly.

### 3.2 Design View (custom three.js viewer)

- Loads STL / 3MF / GLB. STEP is never parsed in the browser: `cad-mcp` exports GLB+STL alongside STEP on every run.
- Measurement tools: point-to-point distance, diameter/circle fit, bounding box.
- Section planes with capped cross-sections.
- Per-object opacity — anatomy ghosts at ~30 % behind a solid prosthetic ("transparent anatomy").
- **Parameter sidebar** ("editable features", honestly scoped): auto-generated from the build123d script's declared parameters; editing a value re-runs the script and hot-reloads the view. The panel is a viewer + parameter surface, **not** a mesh editor — deeper edits go through chat ops or the FreeCAD hatch.
- Deviation heatmap overlay (vertex colors from `mesh-mcp compare`).

### 3.3 Print View (three.js)

- X2D build plate with the oriented part; dual-nozzle usable zone shown when the aux nozzle is in play.
- Layer-by-layer toolpath preview parsed from the sliced `.gcode.3mf`, layer slider, colored by feature (wall / infill / support).
- Pre-slice overhang heatmap (from `mesh-mcp overhang_map`).
- Stats card: print time, filament grams per AMS slot, cost estimate — parsed from the slicer report.
- Later (P4): live job status over MQTT (progress, layer, temps) and chamber-camera snapshots.

## 4. MCP lineup

Spine = four custom thin servers, standard uv + FastMCP pattern (figures-mcp / literature-mcp precedent). No good off-the-shelf servers exist for the medical lane; this is the product's moat.

### 4.1 medimage-mcp (custom)

Wraps pydicom, dcm2niix, SimpleITK, TotalSegmentator.

- `import_dicom(folder)` — de-identify (pydicom strip of the PS3.15 basic-profile identifier set → opaque case ID), convert to NIfTI, record series metadata (slice thickness, spacing, modality).
- `segment(volume, structures | "all")` — TotalSegmentator; backend chain local-CUDA → lab-server → CPU-fast. CT and MR model variants. License note: free for research/education use.
- `mask_to_mesh(mask, structure)` — flying-edges surface extraction + **volume-preserving Taubin smoothing** (never plain Laplacian, which shrinks anatomy), isotropic resampling when voxels are anisotropic.
- `list_structures(volume)` — available/segmented structures with volumes (ml).

### 4.2 mesh-mcp (custom)

Wraps trimesh, PyMeshLab, Open3D.

- `repair` (watertight/manifold fix), `decimate`, `boolean`, `hollow` (+drain holes), `scale_check`.
- `measure` (distances, bbox, volume), `thickness_map`, `overhang_map` (face-angle vs. print orientation).
- `compare(mesh, reference)` — HD95 + mean surface distance vs. the source segmentation surface; writes the QA report and a heatmap-colored mesh.
- `render(mesh | scene)` — offscreen multi-view PNG contact sheet + optional section renders, so the **agent can see its own geometry** (figures-mcp render/review lesson). Windows note: try Open3D OffscreenRenderer first; fall back to pyrender if D3D/EGL misbehaves.

### 4.3 cad-mcp (custom)

Wraps build123d (OCCT B-rep kernel).

- `run_script(script, params)` — executes a build123d script → STEP + STL + GLB; script and params are stored in the case.
- `introspect_params(script)` — feeds the Design View parameter sidebar.
- Fit-reference import: load an organ mesh (from the medical lane) as a reference solid/surface for patient-matched parts.

### 4.4 print-mcp (custom)

Wraps Bambu Studio CLI.

- `slice(model, profile, orientation?, supports?)` — X2D machine/filament profiles → `.gcode.3mf` + JSON report (time, filament per slot, warnings).
- `map_ams(structure→slot)` — per-structure filament color assignment (multi-color anatomy: tumor red, parenchyma white, vessels blue in one print). Dual-nozzle strategy: dissolvable/breakaway support on the auxiliary nozzle for clean organic surfaces.
- ~~`send_to_printer(job)` + `printer_status()` — LAN Developer Mode (FTPS upload + MQTT).~~ **AMENDED 2026-08-14 (Azam): the lab's X2D accepts jobs by USB only — it is not network-connected.** Network delivery and MQTT live status are therefore out of scope for the whole project, not merely deferred. Replaced by `export_to_usb(job)`: write the sliced `.gcode.3mf` to a removable drive, verify the copy by hash, and report which drive to carry to the printer. The P4 "MQTT live status + camera" item is struck for the same reason.

### 4.5 Escape hatches and human GUI tools

- **blender-mcp** (ahujasid's existing server) — organic sculpting, mold-making, cleanup beyond scripted ops. Config-only to wire (P1).
- **FreeCAD** via our own mandible-project RPC addon (localhost:9875) wrapped as an MCP — human-in-the-loop parametric edits on the same STEP files. Preferred over demo-grade community FreeCAD servers. (P4)
- **3D Slicer** stays installed as a manual segmentation/QA tool for tricky cases; an optional slicer-mcp wrapper is a P4+ item, not the spine.
- **Bambu Studio GUI** for one-off prints and profile tuning.

## 5. Case model, provenance, gates

### 5.1 Workspace layout

```
cases/<case-id>/
  dicom/           raw import (de-identified at ingest)
  nifti/           converted volumes
  segmentations/   masks (.nii.gz) + labels.json
  meshes/          repaired STLs + qa/ reports
  cad/             build123d scripts + STEP/GLB
  prints/          3MF projects, sliced .gcode.3mf, print report
  provenance.json  machine-owned append-only log
```

### 5.2 Provenance (machine-owned)

`provenance.json` and `meshes/qa/` are protected with `permission.edit` **deny** in both configs (references.bib pattern) — the agent can never hand-edit a QA verdict (closes the GENSIC self-evaluator hole). Every tool call appends: step, tool + version, parameters, input/output SHA-256. Any printed model is reproducible from its scan.

### 5.3 Hard gates (checks run in tool code, never agent judgment)

- **Mesh Gate** — before a mesh may enter CAD or slicing:
  - watertight + manifold;
  - minimum wall ≥ 1.2 mm (0.4 mm nozzle default, configurable);
  - millimeter-units sanity: mesh bbox within 1.05× of the mask bbox (catches 10×/1000× unit bugs);
  - deviation vs. source segmentation within tolerance — default HD95 ≤ 0.5 mm (per-case configurable), MSD reported.
- **Print Gate** — before g-code leaves the app:
  - zero slicer errors;
  - support strategy explicitly chosen (aux-nozzle material or same-material, never silently defaulted);
  - material appropriate to use (chamber-assisted ABS/ASA/PA for load-bearing prosthetic parts; PLA acceptable for display anatomy);
  - stats report attached to the case.

### 5.4 PHI

De-identification happens at import; patient identifiers never enter model context, filenames, or the lab GPU server (which only ever receives de-identified NIfTI). The case-ID ↔ patient map lives in `cases/.identity/` — gitignored, edit-denied, never read into context.

## 6. Skills pack

Auto-discovered `SKILL.md` files (office-skills / PCB-pack pattern):

1. `segment-anatomy` — protocol choices, CT vs MR models, when to distrust auto-segmentation and hand off to 3D Slicer.
2. `make-printable` — repair → hollow → orient → Mesh Gate workflow.
3. `parametric-part` — build123d idioms + FDM tolerance tables (hole +0.2 mm, sliding clearance 0.3 mm, press fit −0.1 mm).
4. `print-on-x2d` — profiles, AMS mapping, dual-nozzle support strategy, material selection.
5. `accuracy-report` — HD95/MSD reporting conventions radiologists will accept.

## 7. Build order

Each phase gets its own implementation plan (writing-plans); P1 is next.

- **P1 — Chassis + generic lane.** Fork boot, minimal rebrand, launcher + config isolation, Preview panel with Design View, mesh-mcp + cad-mcp, blender-mcp wired. *Acceptance: "design a sample-tube rack" → parametric STL appears in the panel, parameter sidebar re-runs it, render tool returns PNGs.*
- **P2 — Medical lane.** medimage-mcp with the GPU fallback chain, Medical View (NiiVue), Mesh Gate + provenance + PHI handling live. *Acceptance: drop an anonymized CT export → "print me the liver" → gated, QA-reported mesh visible in both Medical and Design views.*
- **P3 — Print lane.** print-mcp, Print View, Print Gate, AMS color mapping. *Acceptance: sliced `.gcode.3mf` with per-structure colors + stats card; send-to-printer verified on the lab X2D or documented fallback.*
- **P4 — Power tools.** FreeCAD hatch, in-view deviation heatmaps, MQTT live status + camera, prosthetic fit helpers (mesh-reference modeling), optional 3D Slicer wrapper.

## 8. Risks and verification items

| Risk | Mitigation |
|---|---|
| ~~X2D LAN Developer Mode / MQTT surface unconfirmed~~ | **Resolved 2026-08-14: moot. The lab printer takes USB only, so the app's job ends at a verified file on a removable drive.** |
| Bambu Studio CLI flag surface on Windows | Verify in P3; OrcaSlicer CLI is the alternate once X2D profiles land. |
| Open3D offscreen rendering on Windows | pyrender fallback; decided in P1 when `render` is built. |
| TotalSegmentator weights license | Free for research/education — fine for the lab; revisit if the tool is ever commercialized. |
| CPU-only fallback quality (3 mm fast mode) | Acceptable for many display prints; the QA report always states the segmentation resolution used. |

## 9. Out of scope

Surgical guides and anything implantable/patient-contacting that requires regulatory clearance; PACS/C-FIND integration; resin/SLS lanes; gen-AI text-to-3D for patient geometry (patient geometry only ever comes from imaging or parametric CAD). Generic decorative gen-3D can be revisited later as a clearly separate, never-medical lane.
