"""Change how a part is printed without opening Bambu Studio.

The operator asks for an outcome -- "use less filament", "make it stronger" --
and that has to become concrete slicer keys inside the project the CLI slices.
Bambu stores those in `Metadata/project_settings.config`, so nothing here needs
the GUI: the template still supplies the printer, filament and process the lab
chose, and this only edits the handful of keys that control density.

Two rules keep that safe.

* Only the keys named below can be changed. A template is an audited artifact;
  a free-form patch over it could silently swap the machine or the filament.
* Every knob has a floor that depends on what the part is for. The gate already
  divides intended uses into load-bearing and display (see gate.py), and that
  same split decides how thin a part may be made. A request under the floor is
  refused with the reason, never quietly clamped -- an operator who thinks they
  got 5% infill on an orthosis must not be handed 25% under the same name.

Keys and their value formats were read from the shipped X2D profiles: Bambu
stores every setting as a string, densities as a percent string ("15%").
"""
from .gate import DISPLAY_USES, LOAD_BEARING_USES


class UnsafeSetting(ValueError):
    """A requested setting is below the floor for this part's intended use."""


class UnknownSetting(ValueError):
    """A setting that is not one of the adjustable knobs."""


class Knob:
    def __init__(self, key, kind, lo=None, hi=None, choices=None, help=""):
        self.key = key
        self.kind = kind
        self.lo = lo
        self.hi = hi
        self.choices = choices
        self.help = help

    def coerce(self, value):
        """Validate against the knob's own range and return Bambu's string form."""
        if self.kind == "percent":
            number = float(str(value).rstrip("%").strip())
            if not self.lo <= number <= self.hi:
                raise UnsafeSetting(f"{self.key} must be between {self.lo}% and {self.hi}%, got {number}%")
            # Bambu writes whole percents; 12.5% is not round-tripped by the GUI.
            return f"{int(round(number))}%", number
        if self.kind == "int":
            number = int(float(value))
            if not self.lo <= number <= self.hi:
                raise UnsafeSetting(f"{self.key} must be between {self.lo} and {self.hi}, got {number}")
            return str(number), number
        if self.kind == "float":
            number = float(value)
            if not self.lo <= number <= self.hi:
                raise UnsafeSetting(f"{self.key} must be between {self.lo} and {self.hi}, got {number}")
            return f"{number:g}", number
        if self.kind == "bool":
            truth = str(value).strip().lower() in ("1", "true", "yes", "on")
            return ("1" if truth else "0"), truth
        if self.kind == "choice":
            text = str(value).strip().lower()
            if text not in self.choices:
                raise UnknownSetting(f"{self.key} must be one of {', '.join(sorted(self.choices))}, got {text!r}")
            return text, text
        raise AssertionError(f"unhandled knob kind {self.kind}")


# The adjustable surface. Deliberately small: these are the settings that
# decide how much plastic a part uses and how strong it ends up.
KNOBS = {
    "infill_density": Knob(
        "sparse_infill_density", "percent", lo=0, hi=100,
        help="How solid the inside is. Lower uses less filament and prints faster.",
    ),
    "infill_pattern": Knob(
        "sparse_infill_pattern", "choice",
        choices={"grid", "gyroid", "honeycomb", "cubic", "line", "triangles", "lightning"},
        help="How the inside is filled. 'lightning' uses the least filament; 'gyroid' is the strongest per gram.",
    ),
    "walls": Knob(
        "wall_loops", "int", lo=1, hi=8,
        help="Number of perimeter shells. Walls carry more load than infill does.",
    ),
    "layer_height": Knob(
        "layer_height", "float", lo=0.06, hi=0.28,
        help="Millimetres per layer. Thicker prints faster and bonds less well between layers.",
    ),
    "supports": Knob(
        "enable_support", "bool",
        help="Whether overhangs get printed support material.",
    ),
    "top_layers": Knob("top_shell_layers", "int", lo=0, hi=12, help="Solid layers on top."),
    "bottom_layers": Knob("bottom_shell_layers", "int", lo=0, hi=12, help="Solid layers on the bed side."),
}

# Floors per category. A part that bears load keeps material; a part that is
# looked at may be hollowed out. These are conservative engineering defaults,
# not a clinical standard -- the Print Gate still runs on the sliced result.
FLOORS = {
    "load-bearing": {"infill_density": 25.0, "walls": 3, "top_layers": 4, "bottom_layers": 3},
    "display": {"infill_density": 5.0, "walls": 2, "top_layers": 2, "bottom_layers": 2},
}
# A thick layer weakens the bond between layers, which is where a loaded part
# breaks first.
LAYER_HEIGHT_CEILING = {"load-bearing": 0.24, "display": 0.28}


def category(intended_use):
    """Which floor set applies. Mirrors the gate's own split, so the two agree."""
    use = str(intended_use or "").strip().lower()
    if use in LOAD_BEARING_USES:
        return "load-bearing"
    if use in DISPLAY_USES:
        return "display"
    raise UnsafeSetting(
        f"intended_use must be stated before print settings can be changed - one of "
        f"{', '.join(LOAD_BEARING_USES + DISPLAY_USES)}. It decides how thin the part may be made."
    )


def resolve(requested, intended_use):
    """Turn requested adjustments into slicer keys, refusing anything unsafe.

    Returns {"patch": {slicer_key: string_value}, "applied": {name: value},
    "category": "load-bearing" | "display"}.
    """
    group = category(intended_use)
    floors = FLOORS[group]
    patch, applied = {}, {}
    for name, value in (requested or {}).items():
        knob = KNOBS.get(name)
        if knob is None:
            raise UnknownSetting(
                f"{name!r} is not an adjustable print setting. Available: {', '.join(sorted(KNOBS))}."
            )
        text, number = knob.coerce(value)
        floor = floors.get(name)
        if floor is not None and number < floor:
            raise UnsafeSetting(
                f"{name} {number} is below the floor of {floor} for a {group} part "
                f"({intended_use}). Lowering it further would weaken the part where it carries load. "
                f"If this really is a display model, slice it with that intended_use instead."
            )
        if name == "layer_height" and number > LAYER_HEIGHT_CEILING[group]:
            raise UnsafeSetting(
                f"layer_height {number} mm is above the ceiling of {LAYER_HEIGHT_CEILING[group]} mm "
                f"for a {group} part ({intended_use}). Thick layers bond poorly, and that is where a "
                f"loaded part fails."
            )
        patch[knob.key] = text
        applied[name] = number
    return {"patch": patch, "applied": applied, "category": group}


def describe():
    """The knobs, for a tool docstring or an operator who asks what can change."""
    return {
        name: {
            "slicer_key": knob.key,
            "help": knob.help,
            "range": (
                sorted(knob.choices) if knob.choices
                else ("on/off" if knob.kind == "bool" else [knob.lo, knob.hi])
            ),
        }
        for name, knob in KNOBS.items()
    }
