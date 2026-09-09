# P3 Acceptance — Print Lane Walkthrough

The scripted acceptance (`scripts/accept_p3.py`) proves the parsers, the Print
Gate, the AMS mapping and the verified USB export without a slicer, and
`--real` proves the same chain over a genuine sliced archive. This walkthrough
is the human pass, and it ends where the lane ends: a file on a stick, in the
printer, printing.

Delivery is **USB only**. The lab X2D is not networked — there is no
`send_to_printer`, no LAN mode, no MQTT. Anything that claims to push a job to
the printer over the network is not part of this system.

## 0. Prerequisite — the X2D template project

Bambu Studio's CLI cannot be handed loose presets: `--load-settings` with
exported preset JSON is rejected, and composing `project_settings.config` from
the shipped system profiles crashes the slicer outright. What works is a
complete project authored by Bambu Studio, whose settings we never touch.

So the lab exports one template per material/process, once:

1. Open **Bambu Studio**.
2. In the **printer** selector at the top left, choose **Bambu Lab X2D** with the
   **0.4 nozzle**. If it is not in the list, click the selector → *Add printer*
   and add the X2D. **This step is the one that matters** — a template exported
   with another printer selected slices a plausible file for the wrong machine.
3. Confirm the process preset now reads something like `0.20mm Standard @BBL X2D`
   and the filament reads `... @BBL X2D`.
4. Load any single object (the shipped calibration cube is fine).
5. **File → Export → Export project (.3mf)** into
   `3D-Coder\workspace\print-templates\x2d-pla.3mf`.

Verify it:

```powershell
print-mcp\.venv\Scripts\python.exe -c "from coder3d_print import project; print(project.validate_template(r'C:\Users\azamk\Documents\3D-Coder\workspace\print-templates\x2d-pla.3mf'))"
```

The printed `printer` must contain **X2D**. If it says A1, P1S, or anything
else, redo step 2 — the Print Gate will refuse the job later anyway, but it is
cheaper to catch it here.

Repeat for each material you keep on the shelf (`x2d-abs.3mf`, and so on).

## 1. Slice from chat

Open the **workspace** project and prompt:

```
Slice cases/hand-prosthesis/meshes/finger_prosthesis.stl for the X2D using the
x2d-pla template. It is a prosthetic part, so use ABS. No support.
```

The agent calls `list_print_templates`, then `slice_model` with the strategy,
the material and the intended use. Both `support_strategy` and `intended_use`
are required arguments: the gate refuses `auto` and refuses to guess what the
part is for, because that is what decides whether the material is adequate.

Expect back a print time, a weight, and a **gate verdict**. A failed gate is
reported as a failure — the job file stays on disk so the verdict can be read,
but it must not go to the printer.

## 2. Read the Print View

The finished slice opens the **Print View** by itself (or click the
`.gcode.3mf` under `prints/` in Files):

- the X2D plate with the toolpath on it, framed on the **part** rather than the
  whole bed
- **two layer sliders, a top and a bottom.** The bottom one cuts layers away, so
  a part that is otherwise a solid opaque mass can be sliced open and looked
  into. `one layer` shows a single layer; `all` restores the whole job.
- a **feature legend**, coloured the way the slicer classified each extrusion:
  outer wall, inner wall, sparse infill, solid infill, bridge, overhang, top
  surface, gap infill. **Click a swatch to recolour that feature; click its name
  to hide it** — hiding the walls is how you see the infill underneath. Colours
  persist across restarts, and `Reset` puts them back.
- `Colour by: Feature | Solid` — Solid paints everything one colour and
  highlights the top layer, which is the quicker read when checking a surface.
- the stats card: print time, grams, printer, support strategy, material, layer
  height, and the per-slot AMS colours
- the **Print Gate badge**. Green means every check passed. Red lists exactly
  which checks failed and why.

Drag the top slider from the bottom up. The first layer should match the part's
footprint, and the top should match its top surface.

The mesh viewer in **Design View** has the same idea under **Appearance** (top
right): part colour, a transparency slider, and an edges toggle — for looking
into a socket or a cavity without slicing it first.

### Open in Bambu Studio

The header carries an **Open in Bambu Studio** button whenever a sliced job or a
project 3MF is on screen. It hands that exact file to the installed Bambu
Studio, for the checks that belong in the slicer — per-layer speed and flow,
seam placement, manual supports — rather than reimplementing them here. The
button only appears when Bambu Studio is actually installed, and it can only
open files inside the workspace.

## 3. Check the gate verdict

Read `cases/<case>/prints/qa/<job>.gate.json` if you want the full detail. The
checks are:

| check | refuses |
|---|---|
| `slicer_ok` | a project that was never sliced, or an unreadable archive |
| `machine` | a file sliced for a printer that is not the X2D |
| `support_strategy` | `auto`/unstated, or a strategy that contradicts the sliced file |
| `plate_fit` | a part that does not fit, measured as authored (nothing is rotated for you) |
| `material_fit` | a load-bearing part in a display material, or an unstated intended use |
| `stats_attached` | a job that reports no print time or weight |

`prints/qa/` is machine-owned: only tool code writes it, in all three configs.

## 4. Export to USB

Insert the stick, then prompt:

```
List the USB drives, then export the job to the stick.
```

`export_to_usb` refuses a job whose gate verdict is missing or failed — the
stick is the last place a wrong file can still be stopped. On success it
reports the SHA-256 it wrote and confirms the bytes on the stick match the
source, and the hash lands in the case's `provenance.json`.

## 5. Print

1. Eject the drive from Windows.
2. Insert it into the X2D.
3. On the printer's screen, open the USB file list and select the job by name.
4. Load the filament the plan named, in the AMS slots the stats card showed.
5. Start the print and **watch the first layer**. It should match the bottom of
   the layer slider preview. If it does not, stop the print — the file on the
   stick is not the job that was previewed.

## Acceptance is met when

- a gated mesh slices for the X2D with a green Print Gate badge,
- the Print View shows the plate, the layers and the stats,
- `export_to_usb` writes and verifies the file,
- the X2D prints it, and the first layer matches the preview,
- and `provenance.json` records the slice, the gate verdict and the exported
  hash, so the printed object can be traced back to the scan it came from.
