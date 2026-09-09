# Knee brace cuff — design

Date: 2026-08-15
Status: approved, not yet implemented

## Context

A hinged ROM (range-of-motion) knee brace, generic **medium** size, in the style of
a standard post-operative brace: two rigid cuffs above and below the knee, joined
by uprights running to a hinge at the joint line, closed with wide hook-and-loop
straps over foam liners.

The brace as a whole decomposes into five subsystems:

1. Hinge — polycentric geometry plus the ROM stop mechanism
2. Uprights — structural spans carrying load past the joint. **BOUGHT, not
   printed** (corrected 2026-08-15). Earlier prose in this spec implied the
   uprights were printed, which contradicts the interface actually designed: the
   cuff boss clamps a standard flat orthotic bar, and a bar is a bought part.
   Bought is also right on merit — the upright is the load path from cuff to
   hinge, and printed PETG is the wrong material for it. The only printed
   subsystem is the cuffs.
3. **Cuffs — the limb interface (this spec)**
4. Soft goods — straps, buckles, foam liners, condyle pad
5. Fasteners — joining uprights to cuffs and hinge

**The hinge is bought, not printed.** A knee brace is load-bearing across the
body's largest joint, and the hinge is the one place where failure is dangerous
rather than inconvenient: a sheared pin under load is a fall. Commercial ROM
hinges are machined aluminium for that reason. The printed content is therefore
the size-specific part — the cuffs — which is where printing actually wins.

This spec covers subsystem 3 only. Subsystems 1, 2, 4 and 5 are out of scope and
get their own specs.

## Approach

A **parametric elliptical half-shell**, lofted along the limb axis.

Two approaches were rejected:

- **Anatomically-shaped shell from a scan.** Best possible contact, but there is
  no leg scan available, and for a *generic medium* it is conceptually wrong —
  it would ship one specific person's leg as the size standard.
- **Flat-pattern shell, heat-formed.** Excellent printability, but it relocates
  fitting into a manual heat-gun process, so repeatability drops and "medium"
  stops meaning much.

For a generic size, anatomical fidelity buys less than it would for a
patient-specific device. Every real brace solves the residual mismatch between
rigid shell and soft tissue with foam and wide straps, not with shell geometry.

**One script, two configurations.** The thigh and calf cuffs are the same object
at different circumferences, tapers and heights, so they are one parametric
script driven twice — not two scripts.

## Geometry

**Axis convention.** Z runs along the limb, Z=0 at the proximal rim. X is
medial–lateral, Y is anterior–posterior.

**Cross-section.** An ellipse solved from *circumference*, not from a radius. A
limb is measured with a tape, so the parameter typed in should be the parameter
measured. Given circumference `C` and the AP/ML aspect ratio, the semi-axes are
solved from Ramanujan's ellipse-perimeter approximation:

    P ≈ π [ 3(a+b) − sqrt((3a+b)(a+3b)) ]

This mirrors the discipline applied to the finger prosthesis, where
`fit_clearance` was kept separate from `residual_diameter` so the measurement
parameter stays a measurement.

**Taper.** Linear along the axis, expressed as a *circumference reduction over
the cuff height* rather than as an angle — again, the unit the user can measure.
Both thigh and calf narrow toward the knee.

**Wrap.** The shell spans `wrap_angle` (default ~200°), opening anteriorly so it
cradles from behind and the straps close over the front. This matches standard
brace construction and is the only arrangement that can be donned over a bent
knee.

**Rims.** Flared at both ends, as on the finger prosthesis socket, so no edge
loads into soft tissue.

## The upright interface

A thickened boss on the lateral face carrying a rectangular through-slot for a
flat orthotic upright bar, plus two fastener holes at a fixed pitch.

The interface targets the **standard flat orthotic upright** rather than a
specific hinge product. Designing to one SKU's bolt pattern welds the design to a
supply chain; designing to the flat-bar standard means any hinge accepting that
bar works. The bar dimensions stay parametric so a different size is a slider,
not a rewrite.

## Strap slots

Rectangular slots inboard of each open edge for webbing to thread through,
positioned so they do not cut the loaded section between the upright boss and the
shell body.

## Print

**Orientation: standing on the distal rim, with a brim.** Layer lines then run as
horizontal hoops, so strap tension acts along layers rather than across them. Bed
contact is only a thin arc, so the brim is required, not optional.

**Material: PETG.** PLA is brittle and creeps at temperature; this part is
structural and may sit in a warm car.

## Parameters

All in mm unless noted. The table separates values that are **engineering
choices** — mine to make and defensible from geometry or print process — from
values that are **measurements of the world**, which cannot be invented.

Engineering choices:

| Parameter | Default | Basis |
|---|---|---|
| `wrap_angle` | 200° | enough to cradle the limb, still donnable over a bent knee |
| `shell_thickness` | 3.0 | structural PETG shell; ≥ 1.2 minimum is met with wide margin |
| `cuff_height` | 90 | fits between joint line and the limb's taper without bridging both |
| `aspect_ratio` | 1.0 | neutral starting point — a circular section. Not an anthropometric claim; tune once a real cross-section is known |
| `fastener_diameter` | 4.0 | M4, the smallest size sane for a structural joint in plastic |

Measurements of the world — **all provisional, see Open items**:

| Parameter | Purpose | Depends on |
|---|---|---|
| `limb_circumference` | tape measurement at cuff mid-height | medium sizing bands |
| `circumference_taper` | circumference reduction proximal to distal | limb anatomy over the cuff's span |
| `upright_width` | flat bar width | orthotic upright standard |
| `upright_thickness` | flat bar thickness | orthotic upright standard |
| `fastener_pitch` | centre distance between fixing holes | the upright's own hole spacing |
| `strap_slot_width` | webbing width | the strapping actually bought |

## Open items — must be closed before anything is worn

Six defaults are **provisional and unverified**. Each is marked as such in the
script and must be replaced with a real value before a cuff is printed and worn:

1. `limb_circumference` — medium sizing bands from commercial ROM brace size
   charts, cross-checked against published anthropometry, including *where* on
   the limb the measurement is taken. A circumference without a measurement site
   is meaningless.
2. `circumference_taper` — how much the limb narrows over the cuff's 90 mm span,
   which differs between thigh and calf.
3. `upright_width` — the flat orthotic upright standard, or the specific bar
   being bought.
4. `upright_thickness` — as above.
5. `fastener_pitch` — set by the upright's own hole spacing, so it follows from 3
   and 4.
6. `strap_slot_width` — set by the webbing actually bought.

These were not resolved during design because the lookup required `WebSearch`,
which is not permitted in the working session; writing the permission into
`.claude/settings.json` is likewise gated, correctly, so the agent cannot
self-grant. The geometry does not depend on any of them — only the starting
slider values do — so implementation can proceed and the defaults can be
corrected in a single edit.

Hardware in hand beats any published chart. If the upright and webbing are bought
before implementation, items 3–6 resolve by measurement and only 1 and 2 remain.

## Verification

The build is not "done" until all of the following pass, measured off the
exported mesh rather than asserted from parameters:

- watertight, one solid
- minimum wall measured by cross-section sampling, ≥ `shell_thickness` within
  tessellation tolerance
- bounding box inside 256 × 256 × 260 mm
- upright slot measured against its nominal width and thickness
- strap slots clear of the loaded section
- renders inspected from four angles including from below

This is the standard applied to the finger prosthesis, where the first build came
back not watertight and the cause — a degenerate triangle at a revolve pole — was
found by characterising the defect rather than by guessing.

## Out of scope

Hinge, uprights, soft goods, fasteners, patient-specific fitting, and any
clinical validation. A model cannot establish fit; that comes from a test print
of a short section before committing to a full cuff.
