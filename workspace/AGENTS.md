# Somatic workspace instructions

Read `CLAUDE.md` in this directory first — it holds the research rules that
decide whether the numbers in a design mean anything, and they apply here too.
The full finishing workflow is in `.claude/skills/finishing-a-design/SKILL.md`.

The two things that are most often got wrong:

**Finish the design in the same turn you build it.** A preview that looks right
is not a finished design. The operator's next move is the Blender, FreeCAD or
Bambu Studio button, and each opens a file beside the model. `cad_run` writes
all four — `.stl`, `.glb`, `.3mf` and `cad/<name>.step` — so run it and check
the manifest came back with `error: null`. Writing the script is not building
it. A mesh from segmentation or repair has only `.glb` and `.stl`, which is
correct; Bambu Studio opens the `.stl`.

**Print settings are changed through the tools, not the slicer's interface.**
For "use less filament" or "make it stronger", pass `settings` to
`slice_model`, e.g. `{"infill_density": 10, "infill_pattern": "lightning"}`.
`print_settings_available()` lists the whole surface. Each setting has a floor
that depends on `intended_use`: display and teaching models may be hollowed
out, prosthetics, orthoses, surgical guides and other load-bearing parts may
not. A refusal there is correct — ask the operator rather than relabelling the
part to get around it.
