# Knee Brace Cuff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parametric elliptical half-shell cuff for a generic-medium hinged ROM knee brace, driveable from the parameter sidebar and printable on a Bambu X2D.

**Architecture:** One build123d script following the `PARAMS` + `build(p)` convention. Cross-sections are ellipses solved from *circumference* (closed-form inversion of Ramanujan's perimeter approximation), lofted along the limb axis with a linear taper and flared rims. The shell is the difference of an outer loft and an inward-offset inner loft; a wedge cut opens it anteriorly; a lateral boss carries the upright slot and fastener holes; strap slots are cut inboard of each open edge.

**Tech Stack:** Python 3.12, build123d (algebra API), OCCT. Verification via `pytest` for pure math, in-build asserts for geometry invariants, and mesh measurement with `trimesh` for anything that must be true of the exported STL.

**Spec:** `docs/superpowers/specs/2026-08-15-knee-brace-cuff-design.md`

## Global Constraints

- **Case folder:** `cases/knee-brace/`, following the layout of `cases/demo/` and `cases/hand-prosthesis/` (`cad/`, `meshes/`).
- **Convention:** module-level `PARAMS` dict (`default`/`min`/`max`/`step`/`unit`) plus `build(p)` returning one solid. This is what the parameter sidebar and `cad_run` require.
- **Build volume:** the finished part must fit inside **256 × 256 × 260 mm**.
- **Minimum wall:** **1.2 mm** anywhere (0.4 mm nozzle). `shell_thickness` defaults to 3.0 mm, so this is a floor, not a target.
- **One solid, watertight.** Not negotiable — the mesh gate rejects anything else.
- **Six defaults are PROVISIONAL** and must carry an inline `PROVISIONAL` comment naming what they depend on: `limb_circumference`, `circumference_taper`, `upright_width`, `upright_thickness`, `fastener_pitch`, `strap_slot_width`. See the spec's Open items.
- **Python interpreter:** `C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe` has build123d. `C:/Users/azamk/Documents/3D-Coder/mesh-mcp/.venv/Scripts/python.exe` has trimesh. They are different environments; do not expect one to import the other's packages.
- **Commit style:** conventional commits scoped `feat(3d-coder):` / `test(3d-coder):`, committed in the `Documents` repo. **Never add a Co-Authored-By or "Generated with" trailer** — Azam is sole author.
- **Two known OCCT traps, both hit earlier in this project:**
  1. A revolved or lofted profile terminating **on** the axis of revolution creates a pole singularity that tessellates to a degenerate triangle and a non-watertight STL. Keep profiles off the axis.
  2. Lofting between wires with **differing vertex counts** makes OCCT crawl (30+ minutes). Keep every section in a loft topologically identical.

## File Structure

| File | Responsibility |
|---|---|
| `cases/knee-brace/lib/cuff_math.py` | Pure geometry maths — no build123d import. Ellipse solving, section ladder, slot placement arithmetic. Unit-testable. |
| `cases/knee-brace/lib/test_cuff_math.py` | pytest tests for the above. |
| `cases/knee-brace/cad/cuff.py` | `PARAMS` + `build(p)`. Imports `cuff_math` off `../lib`. All OCCT work lives here. |
| `scratch/cuff_verify.py` | Throwaway mesh measurement — wall thickness, wrap angle, bore integrity. **Not committable: `3D-Coder/scratch` is gitignored, so listing it in a `git add` aborts the whole commit.** |

Splitting the maths out is deliberate: it is the only part that can be tested without a 30-second OCCT build, and keeping it import-clean means the test suite runs in milliseconds.

**The maths and its tests MUST NOT live in `cad/`.** The desktop app treats every
`.py` directly inside a `cad/` folder as a buildable CAD script — `core.ts`:

```js
const SOURCE_RE = /(^|[\\/])cad[\\/][^\\/]+\.(py|params\.json)$/i
```

— and `ipc.ts` re-runs a `.py` on every edit. A helper module or test file put
there is auto-built the instant it is written, fails for having no `PARAMS`,
writes a manifest carrying that error, and leaves a permanently broken script in
the case browser. This was hit during execution: the case showed three scripts,
two of them dead, and the design would not open in the preview panel. A sibling
`lib/` is invisible to the watcher because the pattern only matches `.py`
directly inside `cad/`.

---

### Task 1: Ellipse solver

**Files:**
- Create: `cases/knee-brace/cad/cuff_math.py`
- Test: `cases/knee-brace/cad/test_cuff_math.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `semi_axes(circumference: float, aspect_ratio: float) -> tuple[float, float]` returning `(a_ml, b_ap)` in mm; `ramanujan_perimeter(a: float, b: float) -> float`.

- [ ] **Step 1: Write the failing test**

Create `cases/knee-brace/cad/test_cuff_math.py`:

```python
import math

import pytest

from cuff_math import ramanujan_perimeter, semi_axes


def test_circle_semi_axes_are_the_radius():
    # aspect 1.0 is a circle, so both semi-axes are C / 2pi
    a, b = semi_axes(2.0 * math.pi * 10.0, 1.0)
    assert a == pytest.approx(10.0, abs=1e-9)
    assert b == pytest.approx(10.0, abs=1e-9)


def test_semi_axes_honour_the_aspect_ratio():
    a, b = semi_axes(480.0, 0.85)
    assert b / a == pytest.approx(0.85, abs=1e-9)


def test_semi_axes_round_trip_through_the_perimeter():
    # whatever ratio, feeding the axes back in must recover the circumference
    for ratio in (0.7, 0.85, 1.0, 1.2):
        a, b = semi_axes(480.0, ratio)
        assert ramanujan_perimeter(a, b) == pytest.approx(480.0, rel=1e-9)


def test_ramanujan_matches_the_circle_case():
    assert ramanujan_perimeter(10.0, 10.0) == pytest.approx(2.0 * math.pi * 10.0, rel=1e-12)


def test_zero_circumference_is_rejected():
    with pytest.raises(ValueError):
        semi_axes(0.0, 1.0)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/cad
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_cuff_math.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'cuff_math'`

- [ ] **Step 3: Write minimal implementation**

Create `cases/knee-brace/cad/cuff_math.py`:

```python
"""Pure geometry maths for the knee brace cuff.

Deliberately free of build123d imports: this is the part that can be tested in
milliseconds instead of behind a 30-second OCCT build.
"""
import math


def ramanujan_perimeter(a, b):
    """Ramanujan's second approximation to an ellipse perimeter.

    Accurate to better than 1e-9 relative for the aspect ratios a limb takes,
    which is far past what a tape measure justifies.
    """
    return math.pi * (3.0 * (a + b) - math.sqrt((3.0 * a + b) * (a + 3.0 * b)))


def semi_axes(circumference, aspect_ratio):
    """Semi-axes (a_ml, b_ap) of the ellipse with this circumference.

    A limb is measured with a tape, so circumference is the honest input and
    the radii are derived - not the other way round. Fixing b = r*a makes
    Ramanujan's formula linear in a, so this inverts in closed form rather
    than needing a solver:

        P = pi * a * [ 3(1+r) - sqrt((3+r)(1+3r)) ]
    """
    if circumference <= 0.0:
        raise ValueError(f"circumference must be positive, got {circumference}")
    if aspect_ratio <= 0.0:
        raise ValueError(f"aspect_ratio must be positive, got {aspect_ratio}")
    r = aspect_ratio
    k = 3.0 * (1.0 + r) - math.sqrt((3.0 + r) * (1.0 + 3.0 * r))
    a = circumference / (math.pi * k)
    return a, r * a
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/cad
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_cuff_math.py -v
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff_math.py 3D-Coder/workspace/cases/knee-brace/cad/test_cuff_math.py
git commit -m "feat(3d-coder): ellipse-from-circumference solver for the brace cuff"
```

---

### Task 2: Section ladder

**Files:**
- Modify: `cases/knee-brace/cad/cuff_math.py`
- Test: `cases/knee-brace/cad/test_cuff_math.py`

**Interfaces:**
- Consumes: `semi_axes` from Task 1.
- Produces: `section_ladder(circumference, taper, height, aspect_ratio, rim_flare, rim_height) -> list[dict]`, each dict having keys `z`, `a`, `b` — the outer ellipse at that height, proximal (z=0) to distal.

- [ ] **Step 1: Write the failing test**

Append to `cases/knee-brace/cad/test_cuff_math.py`:

```python
from cuff_math import section_ladder

LADDER_ARGS = dict(
    circumference=480.0, taper=40.0, height=90.0,
    aspect_ratio=1.0, rim_flare=0.02, rim_height=4.0,
)


def test_ladder_spans_the_full_height():
    rungs = section_ladder(**LADDER_ARGS)
    assert rungs[0]["z"] == pytest.approx(0.0)
    assert rungs[-1]["z"] == pytest.approx(90.0)


def test_ladder_has_four_rungs_two_of_them_flared():
    # z=0 flared, z=rim_height nominal, z=height-rim_height tapered, z=height flared
    rungs = section_ladder(**LADDER_ARGS)
    assert len(rungs) == 4
    assert [r["z"] for r in rungs] == pytest.approx([0.0, 4.0, 86.0, 90.0])


def test_flared_rims_are_wider_than_their_neighbours():
    rungs = section_ladder(**LADDER_ARGS)
    assert rungs[0]["a"] > rungs[1]["a"]
    assert rungs[3]["a"] > rungs[2]["a"]


def test_taper_reduces_circumference_toward_the_distal_end():
    rungs = section_ladder(**LADDER_ARGS)
    assert ramanujan_perimeter(rungs[1]["a"], rungs[1]["b"]) == pytest.approx(480.0, rel=1e-9)
    assert ramanujan_perimeter(rungs[2]["a"], rungs[2]["b"]) == pytest.approx(440.0, rel=1e-9)


def test_taper_cannot_close_the_section():
    with pytest.raises(ValueError):
        section_ladder(**{**LADDER_ARGS, "taper": 500.0})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/cad
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_cuff_math.py -v
```

Expected: FAIL — `ImportError: cannot import name 'section_ladder'`

- [ ] **Step 3: Write minimal implementation**

Append to `cases/knee-brace/cad/cuff_math.py`:

```python
MIN_CIRCUMFERENCE_MM = 60.0   # below this the "limb" is not a limb


def section_ladder(circumference, taper, height, aspect_ratio, rim_flare, rim_height):
    """Outer ellipse at each height, proximal (z=0) to distal (z=height).

    Four rungs: a flared rim, the nominal proximal section, the tapered distal
    section, and a second flared rim. The flare is a bell-mouth so no rim edge
    loads into soft tissue - the same treatment the finger prosthesis socket
    uses. Both the outer and the inner loft get the identical flare, so the
    wall thickness is unchanged by it.
    """
    distal = circumference - taper
    if distal < MIN_CIRCUMFERENCE_MM:
        raise ValueError(
            f"taper {taper} mm closes the distal end to {distal} mm, "
            f"under the {MIN_CIRCUMFERENCE_MM} mm minimum"
        )
    if rim_height * 2.0 >= height:
        raise ValueError(f"rim_height {rim_height} mm leaves no room over a {height} mm cuff")

    plan = [
        (0.0, circumference * (1.0 + rim_flare)),
        (rim_height, circumference),
        (height - rim_height, distal),
        (height, distal * (1.0 + rim_flare)),
    ]
    rungs = []
    for z, circ in plan:
        a, b = semi_axes(circ, aspect_ratio)
        rungs.append({"z": z, "a": a, "b": b})
    return rungs
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/cad
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -m pytest test_cuff_math.py -v
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff_math.py 3D-Coder/workspace/cases/knee-brace/cad/test_cuff_math.py
git commit -m "feat(3d-coder): tapered section ladder with flared rims for the brace cuff"
```

---

### Task 3: Buildable outer solid

**Files:**
- Create: `cases/knee-brace/cad/cuff.py`

**Interfaces:**
- Consumes: `section_ladder` from Task 2.
- Produces: `PARAMS` dict; `build(p)` returning a solid; `_outer(rungs)` returning the lofted outer solid.

This task deliberately produces a *solid slug*, not a shell. It proves the loft, the parameter plumbing, and `cad_run` before any of the fragile operations land.

- [ ] **Step 1: Write the script**

Create `cases/knee-brace/cad/cuff.py`:

```python
"""Parametric knee brace cuff - elliptical half-shell (build123d algebra API).

Coordinate system (mm):
    Z = the limb's long axis. Z=0 is the proximal rim, +Z runs distally.
    X = medial-lateral, Y = anterior-posterior, both centred on the axis.

Cross-sections are ellipses solved from circumference, because a limb is
measured with a tape. See cuff_math.semi_axes.

Print: stand it on the distal rim with a brim. Layer lines then run as
horizontal hoops, so strap tension acts along layers rather than across them.
Bed contact is only a thin arc, so the brim is required, not optional. PETG,
not PLA - this is structural and PLA creeps at temperature.
"""
import sys
from pathlib import Path

from build123d import Ellipse, Pos, loft

sys.path.insert(0, str(Path(__file__).parent))
from cuff_math import section_ladder  # noqa: E402

PARAMS = {
    # PROVISIONAL - needs medium sizing bands and a stated measurement site
    "limb_circumference": {"default": 480.0, "min": 250, "max": 700, "step": 5, "unit": "mm"},
    # PROVISIONAL - depends on limb anatomy over the cuff's span
    "circumference_taper": {"default": 40.0, "min": 0, "max": 120, "step": 5, "unit": "mm"},
    "aspect_ratio": {"default": 1.0, "min": 0.6, "max": 1.4, "step": 0.05, "unit": ""},
    "cuff_height": {"default": 90.0, "min": 50, "max": 160, "step": 5, "unit": "mm"},
    "shell_thickness": {"default": 3.0, "min": 1.2, "max": 6, "step": 0.2, "unit": "mm"},
}

RIM_FLARE = 0.02       # bell-mouth as a fraction of circumference
RIM_HEIGHT_MM = 4.0    # axial run the flare is spread over
BUILD_VOLUME_MM = (256.0, 256.0, 260.0)
MIN_WALL_MM = 1.2


def _rungs(p):
    return section_ladder(
        circumference=p["limb_circumference"],
        taper=p["circumference_taper"],
        height=p["cuff_height"],
        aspect_ratio=p["aspect_ratio"],
        rim_flare=RIM_FLARE,
        rim_height=RIM_HEIGHT_MM,
    )


def _outer(rungs):
    """Lofted outer form. Every section is an Ellipse, so all four wires have
    identical topology - lofting between wires of differing vertex counts is
    what makes OCCT crawl."""
    return loft([Pos(0, 0, r["z"]) * Ellipse(r["a"], r["b"]) for r in rungs])


def build(p):
    assert p["shell_thickness"] >= MIN_WALL_MM, (
        f"shell_thickness {p['shell_thickness']:.2f} mm is under the "
        f"{MIN_WALL_MM} mm minimum for a 0.4 mm nozzle"
    )

    rungs = _rungs(p)
    part = _outer(rungs)

    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    return part
```

- [ ] **Step 2: Build it and read the manifest**

```bash
cd /c/Users/azamk/Documents/3D-Coder/workspace
```

Then call the `cad` MCP tool `cad_run` with `script_path` = `cases/knee-brace/cad/cuff.py`.

Expected: `error` is `null`, `watertight` is `true`, and `bbox_mm` is approximately `[155.9, 155.9, 90.0]` — the flared proximal rim at circumference 480 × 1.02 gives a radius of about 77.9 mm.

- [ ] **Step 3: Verify the bbox against the maths**

```bash
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0, r'C:/Users/azamk/Documents/3D-Coder/workspace/cases/knee-brace/cad'); from cuff_math import semi_axes; print(semi_axes(480.0*1.02, 1.0))"
```

Expected: prints approximately `(77.92, 77.92)`, so the bbox X and Y should each be about 155.8 mm. If the manifest disagrees by more than 1 mm, stop and find out why before continuing.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py
git commit -m "feat(3d-coder): brace cuff outer loft, buildable through cad_run"
```

---

### Task 4: Hollow it into a shell

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`

**Interfaces:**
- Consumes: `_outer`, `_rungs` from Task 3.
- Produces: `_inner(rungs, thickness)` returning the bore solid.

- [ ] **Step 1: Add the inner loft and subtract it**

In `cases/knee-brace/cad/cuff.py`, add `offset` to the build123d import line so it reads:

```python
from build123d import Ellipse, Kind, Pos, loft, offset
```

Add this function directly after `_outer`:

```python
def _inner(rungs, thickness):
    """Bore, offset inward from the outer sections by the wall thickness.

    A true offset curve, not an ellipse with the semi-axes reduced by t: the
    inward offset of an ellipse is not an ellipse, and shrinking the axes would
    leave the wall thin at the ends of the major axis. The fallback exists only
    so a refused offset degrades to something measurable rather than raising -
    the wall assert in build() is what catches it.

    Repeats the end sections 1 mm beyond each rim so the subtraction cuts
    cleanly through instead of landing coincident with the outer face. All six
    sections are Ellipse-derived and therefore topologically identical, which
    is what keeps the loft fast.
    """
    lo_z = rungs[0]["z"] - 1.0
    hi_z = rungs[-1]["z"] + 1.0
    plan = [(lo_z, rungs[0])] + [(r["z"], r) for r in rungs] + [(hi_z, rungs[-1])]

    faces = []
    for z, r in plan:
        try:
            section = offset(Ellipse(r["a"], r["b"]), -thickness, kind=Kind.ARC)
        except Exception:
            section = Ellipse(max(r["a"] - thickness, 0.5), max(r["b"] - thickness, 0.5))
        faces.append(Pos(0, 0, z) * section)
    return loft(faces)
```

Replace the body of `build` between `rungs = _rungs(p)` and the asserts with:

```python
    rungs = _rungs(p)
    part = _outer(rungs) - _inner(rungs, p["shell_thickness"])
```

- [ ] **Step 2: Build and check watertightness**

Call `cad_run` on `cases/knee-brace/cad/cuff.py`.

Expected: `error` null, `watertight` true, one solid. Volume should drop to roughly 10–15% of the Task 3 slug.

If `watertight` is false, do **not** guess. Characterise it first, exactly as the finger prosthesis defect was found:

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe scratch/fp_probe.py
```

(adjusting `PATH` in that script to the cuff STL). It reports boundary edges, edges shared by more than two faces, degenerate triangles, and where they sit.

- [ ] **Step 3: Measure the wall**

Create `scratch/cuff_verify.py`:

```python
"""Throwaway: measure wall thickness and wrap angle off the exported cuff mesh."""
import numpy as np
import trimesh

PATH = r"C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\cuff.stl"
CUFF_HEIGHT = 90.0
RIM_H = 4.0
NOMINAL_WALL = 3.0

m = trimesh.load(PATH)
print(f"watertight {m.is_watertight}  volume {m.volume / 1000.0:.2f} cm3  "
      f"bbox {np.round(m.extents, 2).tolist()} mm")

walls = []
for z in np.arange(RIM_H + 1.0, CUFF_HEIGHT - RIM_H, 2.0):
    sec = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if sec is None:
        continue
    v = sec.vertices
    # sample along the +X axis: the wall there is the gap between the two crossings
    on_axis = v[np.abs(v[:, 1]) < 1.0]
    xs = np.sort(on_axis[on_axis[:, 0] > 0][:, 0])
    if len(xs) >= 2:
        walls.append((z, xs[-1] - xs[0]))

w = np.array([x[1] for x in walls])
print(f"wall over {len(walls)} sections: min {w.min():.3f}  mean {w.mean():.3f}  max {w.max():.3f} mm")
print(f"MIN WALL {w.min():.3f} -> {'PASS' if w.min() >= 1.2 else 'FAIL'} against 1.2 mm")
print(f"vs nominal {NOMINAL_WALL}: worst deviation {abs(w - NOMINAL_WALL).max():.3f} mm")
```

Run it:

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe scratch/cuff_verify.py
```

Expected: `MIN WALL ... PASS`, and at `aspect_ratio` 1.0 the deviation from nominal should be under 0.1 mm. Record the number — Task 9 re-checks it at a non-circular aspect ratio, where the offset approximation is actually under test.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py 3D-Coder/scratch/cuff_verify.py
git commit -m "feat(3d-coder): hollow the brace cuff to a measured 3 mm shell"
```

---

### Task 5: Open it anteriorly

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`

**Interfaces:**
- Consumes: the shell from Task 4.
- Produces: `_opening(rungs, wrap_deg)` returning the wedge cutting tool.

- [ ] **Step 1: Add `wrap_angle` to PARAMS**

Insert into `PARAMS`, after `aspect_ratio`:

```python
    "wrap_angle": {"default": 200.0, "min": 120, "max": 300, "step": 5, "unit": "deg"},
```

- [ ] **Step 2: Add the wedge cut**

Extend the build123d import line to:

```python
from build123d import Ellipse, Kind, Polyline, Pos, extrude, loft, make_face, offset
```

Add `import math` at the top, and this function after `_inner`:

```python
WEDGE_SEGMENTS = 48


def _opening(rungs, wrap_deg):
    """Pie wedge removing the anterior gap, so the shell cradles from behind.

    Centred on +Y (anterior) so the straps close over the front - the only
    arrangement that can be donned over a bent knee. Built as a polygon rather
    than a true pie because it is a cutting tool whose curved boundary sits far
    outside the part; only the two straight flanks ever touch geometry.
    """
    gap = 360.0 - wrap_deg
    if gap <= 0.0:
        return None
    reach = 3.0 * max(max(r["a"], r["b"]) for r in rungs)
    pts = [(0.0, 0.0)]
    for i in range(WEDGE_SEGMENTS + 1):
        ang = math.radians(90.0 - gap / 2.0 + gap * i / WEDGE_SEGMENTS)
        pts.append((reach * math.cos(ang), reach * math.sin(ang)))
    face = make_face(Polyline(*pts, close=True).edges())
    lo = rungs[0]["z"] - 2.0
    hi = rungs[-1]["z"] + 2.0
    return Pos(0, 0, lo) * extrude(face, amount=hi - lo)
```

In `build`, after the shell subtraction, add:

```python
    wedge = _opening(rungs, p["wrap_angle"])
    if wedge is not None:
        part = part - wedge
```

- [ ] **Step 3: Build and verify the wrap**

Call `cad_run`. Expected: `error` null, `watertight` true, one solid, and volume down by roughly `(360-200)/360` ≈ 44% from Task 4.

Append to `scratch/cuff_verify.py`:

```python
# wrap angle: the angular extent actually occupied at mid-height
sec = m.section(plane_origin=[0, 0, CUFF_HEIGHT / 2.0], plane_normal=[0, 0, 1])
ang = np.degrees(np.arctan2(sec.vertices[:, 1], sec.vertices[:, 0]))
gap_start, gap_end = np.sort(ang)[0], np.sort(ang)[-1]
covered = 360.0 - (gap_end - gap_start) if (gap_end - gap_start) > 180 else gap_end - gap_start
print(f"angular coverage at mid-height: {covered:.1f} deg")
```

Run it. Expected: coverage close to 200°.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py 3D-Coder/scratch/cuff_verify.py
git commit -m "feat(3d-coder): open the brace cuff anteriorly to a 200 degree wrap"
```

---

### Task 6: Upright boss

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`

**Interfaces:**
- Consumes: the trimmed shell from Task 5.
- Produces: `_boss(rungs, p)` returning the pad solid; `_upright_slot(rungs, p)` and `_fastener_holes(rungs, p)` returning cutting tools.

- [ ] **Step 1: Add the hardware parameters**

Insert into `PARAMS`, after `shell_thickness`:

```python
    # PROVISIONAL - needs the flat orthotic upright standard, or the bar bought
    "upright_width": {"default": 12.7, "min": 8, "max": 25, "step": 0.1, "unit": "mm"},
    # PROVISIONAL - as above
    "upright_thickness": {"default": 3.2, "min": 2, "max": 8, "step": 0.1, "unit": "mm"},
    # PROVISIONAL - set by the upright's own hole spacing
    "fastener_pitch": {"default": 25.0, "min": 12, "max": 60, "step": 1, "unit": "mm"},
    "fastener_diameter": {"default": 4.0, "min": 3, "max": 8, "step": 0.5, "unit": "mm"},
```

- [ ] **Step 2: Add the boss and its cuts**

Extend the build123d import line to include `Box`, `Cylinder` and `Rot`:

```python
from build123d import Box, Cylinder, Ellipse, Kind, Polyline, Pos, Rot, extrude, loft, make_face, offset
```

Add after `_opening`:

```python
BOSS_MARGIN_MM = 4.0     # material around the slot on every side


def _boss_metrics(rungs, p):
    """Where the boss sits and how big it is. Shared by the pad and its cuts
    so the slot cannot drift out of the pad it is cut from."""
    z_mid = (rungs[0]["z"] + rungs[-1]["z"]) / 2.0
    t = (z_mid - rungs[0]["z"]) / max(rungs[-1]["z"] - rungs[0]["z"], 1e-6)
    a = rungs[0]["a"] + (rungs[-1]["a"] - rungs[0]["a"]) * t
    length = p["fastener_pitch"] + 2.0 * p["fastener_diameter"] + 2.0 * BOSS_MARGIN_MM
    return {
        "z": z_mid,
        "x_outer": a,
        "width": p["upright_width"] + 2.0 * BOSS_MARGIN_MM,
        "length": length,
        "depth": p["upright_thickness"] + BOSS_MARGIN_MM,
    }


def _boss(rungs, p):
    """Pad on the lateral (+X) face carrying the upright interface.

    Straddles the outer surface so the union is a solid overlap rather than a
    tangent kiss, which OCCT handles far more reliably.
    """
    m = _boss_metrics(rungs, p)
    slab = Box(m["depth"] + 6.0, m["width"], m["length"])
    return Pos(m["x_outer"] + m["depth"] / 2.0 - 3.0, 0.0, m["z"]) * slab


def _upright_slot(rungs, p):
    """Axial slot the flat bar slides into. Open at the distal end of the boss
    so the bar can be inserted after printing."""
    m = _boss_metrics(rungs, p)
    slot = Box(p["upright_thickness"], p["upright_width"], m["length"] + 4.0)
    x = m["x_outer"] + m["depth"] / 2.0 - 3.0 + 1.0
    return Pos(x, 0.0, m["z"]) * slot


def _fastener_holes(rungs, p):
    """Two holes radially through boss, bar and shell.

    Each tool runs from the axis outward only. A cylinder centred on the axis
    would span the full diameter and drill the opposite wall as well - the
    boss is on +X, so a hole in the -X wall is pure damage.
    """
    m = _boss_metrics(rungs, p)
    reach = 4.0 * m["x_outer"]
    tools = []
    for sign in (-1.0, 1.0):
        cyl = Rot(0, 90, 0) * Cylinder(p["fastener_diameter"] / 2.0, reach)
        z = m["z"] + sign * p["fastener_pitch"] / 2.0
        tools.append(Pos(reach / 2.0, 0.0, z) * cyl)
    return tools
```

In `build`, after the wedge cut:

```python
    part = part + _boss(rungs, p)
    part = part - _upright_slot(rungs, p)
    for hole in _fastener_holes(rungs, p):
        part = part - hole
```

- [ ] **Step 3: Build and measure the slot**

Call `cad_run`. Expected: `error` null, `watertight` true, one solid.

Append to `scratch/cuff_verify.py`:

```python
# upright slot: section across the boss and report the void width in Y and X
BOSS_Z = CUFF_HEIGHT / 2.0
sec = m.section(plane_origin=[0, 0, BOSS_Z], plane_normal=[0, 0, 1])
lat = sec.vertices[sec.vertices[:, 0] > 0]
print(f"boss outer X {lat[:, 0].max():.2f} mm, boss Y span {lat[:, 1].ptp():.2f} mm")
```

Run it and confirm the boss Y span is `upright_width + 2*BOSS_MARGIN_MM` = 20.7 mm within a tenth.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py 3D-Coder/scratch/cuff_verify.py
git commit -m "feat(3d-coder): upright boss, slot and fastener holes on the brace cuff"
```

---

### Task 7: Strap slots

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`

**Interfaces:**
- Consumes: the shell with boss from Task 6.
- Produces: `_strap_slots(rungs, p)` returning a list of cutting tools.

- [ ] **Step 1: Add the parameter**

Insert into `PARAMS`, after `fastener_diameter`:

```python
    # PROVISIONAL - set by the webbing actually bought
    "strap_slot_width": {"default": 38.0, "min": 20, "max": 60, "step": 1, "unit": "mm"},
```

- [ ] **Step 2: Add the slots**

Add after `_fastener_holes`:

```python
STRAP_SLOT_HEIGHT_MM = 4.0     # webbing thickness plus clearance
STRAP_EDGE_INSET_DEG = 12.0    # angular distance from the open edge


def _strap_slots(rungs, p):
    """Through-slots inboard of each open edge for the webbing to thread.

    Placed at two heights so a strap crosses the cuff rather than pulling on
    one band of it, and kept clear of the boss so the loaded section between
    upright and shell is never cut.
    """
    gap = 360.0 - p["wrap_angle"]
    edge = 90.0 + gap / 2.0
    tools = []
    for z_frac in (0.25, 0.75):
        z = rungs[0]["z"] + (rungs[-1]["z"] - rungs[0]["z"]) * z_frac
        a = rungs[0]["a"] + (rungs[-1]["a"] - rungs[0]["a"]) * z_frac
        b = rungs[0]["b"] + (rungs[-1]["b"] - rungs[0]["b"]) * z_frac
        reach = 4.0 * max(a, b)
        for sign in (-1.0, 1.0):
            ang = sign * (edge - STRAP_EDGE_INSET_DEG)
            # X spans the wall radially, Y is the slot's short dimension, Z its
            # length along the limb - then pushed out from the axis and rotated
            # to the edge bearing. Centring it on the axis instead would span
            # the full diameter and cut a second slot in the opposite wall.
            slot = Box(reach, STRAP_SLOT_HEIGHT_MM, p["strap_slot_width"])
            tools.append(Rot(0, 0, ang) * Pos(reach / 2.0, 0.0, z) * slot)
    return tools
```

Note the sign: `edge - STRAP_EDGE_INSET_DEG` moves the slot *inboard* from the
open edge, into material. Using `+` would place it in the gap, where it would
cut nothing and silently produce a cuff with no strap slots at all.

In `build`, after the fastener holes:

```python
    for slot in _strap_slots(rungs, p):
        part = part - slot
```

- [ ] **Step 3: Build and verify**

Call `cad_run`. Expected: `error` null, `watertight` true, one solid.

Then confirm the topology matches the hole count — four strap slots plus two fastener holes is six through-holes, so Euler should be `2 - 2*6 = -10`. Append to `scratch/cuff_verify.py`:

```python
holes = (2 - m.euler_number) // 2
print(f"euler {m.euler_number} -> {holes} through-holes (expect 6: 4 strap + 2 fastener)")
```

Run it.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/cad/cuff.py 3D-Coder/scratch/cuff_verify.py
git commit -m "feat(3d-coder): strap slots inboard of the brace cuff open edges"
```

---

### Task 8: Full verification and renders

**Files:**
- Modify: `cases/knee-brace/cad/cuff.py`
- Modify: `scratch/cuff_verify.py`

- [ ] **Step 1: Add the remaining build asserts**

Replace the assert block at the end of `build` with:

```python
    assert len(part.solids()) == 1, f"expected 1 solid, got {len(part.solids())}"
    valid = part.is_valid
    assert bool(valid() if callable(valid) else valid), "OCCT reports an invalid solid"

    bb = part.bounding_box()
    for axis, size, limit in zip("XYZ", (bb.size.X, bb.size.Y, bb.size.Z), BUILD_VOLUME_MM):
        assert size <= limit, f"{axis} extent {size:.1f} mm exceeds the {limit:.0f} mm build volume"
    assert abs(bb.size.Z - p["cuff_height"]) <= 0.05, (
        f"height came out {bb.size.Z:.2f} mm, expected {p['cuff_height']:.2f} mm"
    )
```

Note `part.is_valid` is a *method* on build123d shapes; reading it without calling returns a truthy bound method and checks nothing. This is the same bug that sat unnoticed in the nose script.

- [ ] **Step 2: Run the full verification**

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe scratch/cuff_verify.py
```

Expected, all of which must hold before this task is done:
- `watertight True`
- `MIN WALL ... PASS` against 1.2 mm
- angular coverage within 2° of 200
- `euler -10 -> 6 through-holes`
- bbox all three axes under 256 / 256 / 260

- [ ] **Step 3: Render and look at it**

Call the `mesh` MCP tool `mesh_render` on `cases/knee-brace/meshes/cuff.stl`, then read all four PNGs.

Then render the shaded four-view sheet, which includes a view from below that the case renders do not provide:

```bash
cd /c/Users/azamk/Documents/3D-Coder
./mesh-mcp/.venv/Scripts/python.exe scratch/nose_sheet.py "cuff=C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\meshes\cuff.stl"
```

Read `scratch/nose_sheet.png`. Confirm by eye: the opening faces anteriorly, both rims are flared, the boss sits on the lateral face, and four strap slots are present.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/workspace/cases/knee-brace/ 3D-Coder/scratch/cuff_verify.py
git commit -m "feat(3d-coder): brace cuff verification asserts and render pass"
```

---

### Task 9: Off-nominal parameter sweep

**Files:**
- Create: `scratch/cuff_sweep.py`

The offset approximation in Task 4 is only under real test when the section is *not* a circle. This task is where that gets checked.

- [ ] **Step 1: Write the sweep**

Create `scratch/cuff_sweep.py`:

```python
"""Throwaway: does the cuff survive its own slider extremes?

Runs unbuffered and writes straight to a file - piping through `tail` has
repeatedly swallowed output in this environment, and long runs get killed
before a buffered stream flushes.
"""
import importlib.util
import sys
import time

TARGET = r"C:\Users\azamk\Documents\3D-Coder\workspace\cases\knee-brace\cad\cuff.py"
spec = importlib.util.spec_from_file_location("cuff", TARGET)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

base = {k: v["default"] for k, v in m.PARAMS.items()}
fails = 0
for name in m.PARAMS:
    for edge in ("min", "max"):
        p = dict(base)
        p[name] = float(m.PARAMS[name][edge])
        t0 = time.time()
        try:
            bb = m.build(p).bounding_box()
            print(f"{name:20s} {edge:3s} = {p[name]:>6} -> OK   {time.time()-t0:5.1f}s  "
                  f"X={bb.size.X:6.1f} Y={bb.size.Y:6.1f} Z={bb.size.Z:6.1f}", flush=True)
        except Exception as exc:
            fails += 1
            print(f"{name:20s} {edge:3s} = {p[name]:>6} -> {type(exc).__name__}: {exc}", flush=True)
print(f"\n{fails} failing slider extreme(s)", flush=True)
```

- [ ] **Step 2: Run it**

```bash
C:/Users/azamk/Documents/3D-Coder/cad-mcp/.venv/Scripts/python.exe -u C:/Users/azamk/Documents/3D-Coder/scratch/cuff_sweep.py > C:/Users/azamk/Documents/3D-Coder/scratch/cuff_sweep.txt 2>&1
```

Then read `scratch/cuff_sweep.txt`.

Expected: `0 failing slider extreme(s)`. Any assert that fires is either a real geometry failure to fix, or an assert whose bound is wrong — decide which before changing anything. Also watch the per-build times: a single extreme taking minutes is itself a defect, as happened with the nose's `ala_flare` maximum.

- [ ] **Step 3: Measure the wall at a non-circular aspect ratio**

Edit `scratch/cuff_verify.py` and change `NOMINAL_WALL` handling to accept an aspect ratio argument, then run `cad_run` with `params` = `{"aspect_ratio": 0.75}` and re-run the verifier.

Expected: `MIN WALL ... PASS` against 1.2 mm. If the deviation from the 3.0 mm nominal exceeds 0.3 mm, the `offset` call in `_inner` fell back to the scaled-ellipse approximation — check by adding a print in the `except` branch, and if so record it in the spec's Open items rather than leaving it silent.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/azamk/Documents
git add 3D-Coder/scratch/cuff_sweep.py 3D-Coder/scratch/cuff_verify.py
git commit -m "test(3d-coder): brace cuff slider sweep and off-nominal wall check"
```

---

## Definition of done

- All nine tasks committed.
- `pytest test_cuff_math.py` green.
- `cad_run` returns `error: null`, `watertight: true` at defaults.
- Measured minimum wall ≥ 1.2 mm at both `aspect_ratio` 1.0 and 0.75.
- `0 failing slider extreme(s)` from the sweep, with no single build taking more than about a minute.
- Four-view renders inspected by eye.
- The six PROVISIONAL defaults still carry their inline comments, and the spec's Open items section is still accurate.

**Not done, and out of scope:** hinge, uprights, soft goods, fasteners, and any fit validation. Fit comes from a test print of a short section, not from a model.
