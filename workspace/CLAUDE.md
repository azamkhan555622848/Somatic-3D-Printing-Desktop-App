# 3D-Coder workspace instructions

This is a medical/radiology-lab 3D printing workspace. Parts made here get worn,
handled, or printed on a Bambu Lab X2D and used for real. Guesses have a cost.

## Research before you model — not after

**Before writing the first line of a CAD script for a new part, go and find out
what the part actually is.** This is not optional and it is not a formality; it
is the step that decides whether the numbers in `PARAMS` mean anything.

Do both halves:

### 1. The engineering ground truth

Search for the real-world specification of the thing:

- published dimensions, tolerances and standards (ISO / ASTM / anthropometric
  tables) — a knee brace has documented circumference and condyle-width ranges,
  a socket has documented wall thicknesses, a tube rack has a tube diameter
- material properties for the intended use — load-bearing, skin contact,
  autoclavable, single-use
- clinical or lab constraints — what has to clear what, what has to be
  removable, what gets cleaned and how

### 2. Existing 3D designs of the same thing

**This is the part people skip, and it is the most valuable one.** Almost
anything you are asked to model already exists as a printed design somewhere.
For a knee brace there are dozens. Go and look at them:

- Printables, MakerWorld, Thingiverse, Thangs, GrabCAD, Cults3D
- NIH 3D Print Exchange and Embodi3D for anatomical and clinical models
- published papers and university repositories for prosthetics and orthoses

Read them for what they teach, specifically:

- what wall thickness, rib pattern and hinge geometry people actually settled on
- the print orientation and support strategy the design was drawn for
- **the comments and remixes** — these are a free failure report. "Snapped at
  the strap slot", "too tight across the calf", "warped at the top edge" is
  exactly the information you cannot derive from a CAD model
- what the design deliberately left out, and why

Use them as reference for dimensions and failure modes. **Do not copy their
geometry** — respect the licence on anything you look at, and model the part
yourself.

## Write down what you found

Put a short `research.md` in the case folder (e.g.
`cases/knee-brace/research.md`) before you model, listing:

- each source, with its URL
- the numbers you took from it and which `PARAMS` key each one feeds
- the failure modes you saw reported, and what your design does about each

Then every default in `PARAMS` traces to something. A parameter that no source
backs is a **provisional guess** — mark it as one, in the file and in what you
tell the user, and say plainly that the part must not be printed and worn until
it is replaced by a measurement. Never let a guessed default pass silently as a
specification.

## If the search comes back empty

Say so. "I searched for X and Y and found nothing usable, so this dimension is
my estimate from Z" is a good answer. Silently inventing a number is not.

## Tooling note

`WebSearch` and `WebFetch` are enabled for this workspace. The session is
non-interactive, so no permission prompt can reach the user — if a tool is
genuinely unavailable, name it and continue with what you have rather than
asking for approval that cannot arrive.
