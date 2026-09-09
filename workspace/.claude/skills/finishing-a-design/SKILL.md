---
name: finishing-a-design
description: Use when a CAD part or an anatomy mesh is built and the operator needs to open it in Blender, FreeCAD or Bambu Studio, slice it, or change how much filament it uses. Covers what must be on disk before a design counts as finished.
---

# Finishing a design

A preview that looks right is not a finished design. The operator's next move
is one of three buttons, and each opens a **file on disk beside the model**. If
that file was never written the button can do nothing, and they have to come
back and ask a second time. Finish the job in the same turn you build it.

## Build with `cad_run`, every time

`cad_run(script_path, params)` builds the part and writes all four outputs
together:

| File | Used by |
|---|---|
| `meshes/<name>.stl` | the mesh everything can read |
| `meshes/<name>.glb` | the Design View preview, and Blender |
| `meshes/<name>.3mf` | Bambu Studio, and slicing |
| `cad/<name>.step` | FreeCAD, the editable B-rep |

Writing the script is not building it. Until `cad_run` has returned a manifest
with `error: null`, nothing new is on disk. If it returns an error, say so and
fix the script — do not describe the part as done.

## What each button needs

| Button | Opens, in order |
|---|---|
| Blender | `<name>.glb`, then `<name>.stl` |
| FreeCAD | `cad/<name>.step`, then `<name>.stl`, `<name>.3mf` |
| Bambu Studio | `<name>.3mf`, then `<name>.stl` |

So a part built by `cad_run` satisfies all three. Check the manifest rather
than assuming.

## Meshes that did not come from CAD

A mesh from segmentation or from `mesh_repair` has only a `.glb` and a `.stl`.
That is normal and correct: there is no CAD script behind it, so there is no
STEP to write, and inventing one would be a lie about where the geometry came
from. Bambu Studio opens the `.stl` directly. Do not try to manufacture a
`.step` or a `.3mf` for an anatomy mesh.

## Changing how it prints

The operator will ask for outcomes: "use less filament", "make it stronger",
"turn supports off". Do not send them to Bambu Studio's interface for this.
Pass `settings` to `slice_model`:

```
slice_model(mesh=..., case_dir=..., template=..., support_strategy=...,
            material=..., intended_use=...,
            settings={"infill_density": 10, "infill_pattern": "lightning"})
```

`print_settings_available()` lists every adjustable setting with its range.
Infill density, infill pattern, walls, layer height, supports, and top and
bottom solid layers are the whole surface. Everything else in the template —
the printer, the filament, the process — stays what the lab chose.

Each setting has a floor that depends on `intended_use`. A display, anatomy,
teaching or planning model can be hollowed out. A prosthetic, orthosis,
surgical guide, fixture or other load-bearing part cannot: asking for less than
the floor is refused, and the refusal is correct. Do not work around it by
relabelling the part's intended use — ask the operator, because that field is
what the Print Gate reasons about.

Filament used is reported in the slice result, so state the before and after
when you change density. That is the number the operator actually asked about.

## Before you say it is finished

- `cad_run` returned a manifest with `error: null`, or the mesh came from
  segmentation and you have said so.
- The files the three buttons need exist, or you have said which do not and
  why.
- If it was sliced, the Print Gate verdict is reported — pass or fail. A failed
  gate is a failure, not a warning to mention in passing.
