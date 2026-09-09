# Fully printed knee brace hinge and uprights — design

Date: 2026-08-16
Status: approved, not yet implemented

## Context

Supersedes the bought-hinge decision in
`2026-08-15-knee-brace-cuff-design.md`. That spec assigned the hinge, uprights,
soft goods and fasteners to bought components, on the grounds that the hinge is
the one place where failure is dangerous rather than inconvenient.

The user has since asked for the brace to be **entirely 3D printed, with no
metal parts at all** — no bolts, no pins, no fasteners. That decision is taken as
given here. This spec designs the best all-printed hinge and uprights available,
and records the resulting limitations plainly rather than relitigating.

Scope: hinge (subsystem 1), uprights (subsystem 2), and the revision the cuff's
upright interface needs as a consequence. Soft goods stay out of scope — straps,
buckles and foam are textile, not printable, and the user has not asked for them
to be printed.

## The material reality that sizes everything

PETG's Young's modulus is roughly 2 GPa against aluminium's 69 — about 34× less.
Bending stiffness scales with thickness cubed, so matching a 12.7 × 3.2 mm
aluminium upright at the same width needs about ∛34 ≈ 3.2× the thickness, call
it **10–11 mm**. The printed brace is therefore visibly bulkier than a
commercial one. This is a consequence to design to, not a problem to solve.

## Approach

### Pivot: a large-diameter boss, not a pin

The obvious response to "no metal pin" is a fatter plastic pin. That is the
wrong instinct — shear stress in a pin scales with 1/d², and a printed pin is
loaded in single shear exactly at the joint line, with its layer planes as
candidate failure surfaces.

Instead the thigh plate carries a **Ø22 mm boss** running in a matching bore on
the calf plate. Bearing and shear stress drop by more than an order of magnitude
for the same load. It also prints far better: the boss is part of a plate laid
flat on the bed, so layers lie in the plate plane and the load path stays
in-plane rather than peeling layers apart.

### Retention: bayonet, no separate fastener

The boss carries a flange; the bore has matching keyhole slots. The plates are
pushed together at one specific angle, rotated, and captured. No retaining ring,
no cap, no fastener.

### Stops: a removable peg, which forces adjustability

A peg on the thigh plate travels in an arc slot on the calf plate; the ends of
the slot are the extension and flexion stops.

**The peg must be a separate printed part.** The bayonet has to be assembled at
some angle, and if the stops were printed solid, that assembly angle would be
unreachable — the hinge could never be put together. This is forced by the
geometry, not an added feature.

Once the peg is removable, the hole it drops into sets the range. **Adjustable
ROM in 10° increments therefore falls out of a mechanism that assembly requires
anyway** — without the detent, retention and fit-tolerance complexity that made a
purpose-built adjustable mechanism unattractive.

### Single axis, not polycentric

Rejected: polycentric needs either twin pivots or a cam slot, both of which
multiply printed fit tolerances, and part of its benefit — tracking the knee's
migrating instantaneous centre of rotation — is absorbed by strap compliance.

Cost, stated honestly: some migration of the brace through the flexion range.
Placing the axis at the average centre of rotation minimises it.

### Uprights

Printed bars, sized from the stiffness arithmetic above: **solid section, 11 mm
thick × 20 mm wide**, printed flat with the long axis in the bed plane.

A ribbed or I-section would give better stiffness per gram, and is the obvious
next optimisation — but it is deferred. A solid bar has no thin webs to fail, no
extra fit tolerances, and gives a known baseline to measure any ribbed version
against. Mass is not a constraint worth optimising before the hinge is proven.

## Consequence: the cuff interface must be revised

The cuff built in the previous spec has a boss with a rectangular slot and two
M4 fastener holes — a metal-fastener interface. All-printed means that becomes a
**dovetail socket with a printed taper wedge driven in from the proximal end**.

Printed rivets were the alternative and are rejected: they load a small printed
shank in shear, which is the failure mode the whole pivot design exists to
avoid, and they cannot be undone for inspection. A wedge loads the dovetail in
compression, can be tapped out, and can be re-driven if the joint loosens — which
it will, because PETG creeps.

The cuff geometry itself is unaffected and stays verified. Only the boss
interface changes: `_boss`, `_upright_slot` and `_fastener_holes` in `cuff.py`
are replaced by a dovetail socket, and `fastener_pitch` / `fastener_diameter`
leave `PARAMS`. This is real rework of finished work and is recorded here so it
is not discovered mid-build.

## Parameters

| Parameter | Purpose | Basis |
|---|---|---|
| `pivot_diameter` | boss OD | Engineering choice, 22 mm nominal |
| `pivot_clearance` | boss-to-bore running fit | 0.35 mm diametral to start — **a guess**, and the single most likely value to need changing after the first test print. Too tight binds; too loose lets the joint rock, which on a 22 mm boss becomes visible slop at the ankle. |
| `plate_thickness` | hinge plate wall | From the stiffness arithmetic |
| `flange_height` | bayonet flange | Engineering choice |
| `stop_range_deg` | arc slot span, extension to flexion | Clinical input — **unverified** |
| `stop_increment_deg` | peg hole spacing | 10°, engineering choice |
| `upright_width` | printed bar width | From stiffness arithmetic, supersedes the bought-bar value |
| `upright_thickness` | printed bar thickness | As above, nominally 11 mm |
| `upright_length` | cuff boss to pivot | Depends on limb geometry — **unverified** |

Values inherited as unverified guesses from the cuff work remain unverified; see
`cases/knee-brace/research.md`.

## Print orientation

- **Hinge plates:** flat on the bed, boss standing proud. Layers in the plate
  plane, so bending and bearing loads act in-plane.
- **Uprights:** flat, long axis in the bed plane, so bending acts across layers
  rather than peeling them.
- **Stop peg:** standing, so its loaded cross-section is intra-layer.
- Material PETG throughout. PLA is brittle and creeps at temperature.

## Safety and limitations

A PETG hinge is not equivalent to a machined aluminium one:

- **Creep** under sustained load — the geometry will change over time.
- **Notch sensitivity** — the arc slot ends and the keyhole slots are stress
  concentrations by construction.
- **Fatigue** — plastic fails faster under cyclic load than metal, and a knee
  hinge is a cyclic-load application by definition.

The spec's position: this is a **prototype**. Inspect the boss, bore and stop peg
before each use, and do not rely on it to stabilise an unstable knee. The
previous spec's reasoning for buying the hinge has not been shown to be wrong —
it has been overridden by an explicit user decision, which is recorded here so
the trade-off stays visible.

## Verification

Measured off the exported mesh, not asserted from parameters:

- watertight, one solid per part
- minimum wall ≥ 1.2 mm on every part
- boss OD versus bore ID: clearance matches `pivot_clearance` within tessellation
  tolerance
- arc slot span produces the intended `stop_range_deg`
- bayonet release angle lies outside the stop range, so the hinge cannot separate
  within its working travel
- every part inside 256 × 256 × 260 mm
- renders inspected from four angles including from below

## Build order

This spec covers three pieces of work, and they are not independent. The
implementation plan should sequence them:

1. **Hinge first.** It is the hard part, and its plate geometry defines the
   upright's mating end — building uprights first would mean designing to an
   interface that does not exist yet.
2. **Uprights second**, once the hinge end is fixed.
3. **Cuff interface revision last**, since it is rework of verified code and
   should not be disturbed until the thing it mates with is settled.

Each is independently testable, so one plan with three phases is appropriate
rather than three specs.

## Out of scope

Soft goods, fit validation, and any clinical assessment. Fit comes from a test
print, not a model.
