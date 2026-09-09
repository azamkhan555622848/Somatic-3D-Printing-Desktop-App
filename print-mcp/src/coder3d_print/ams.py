"""Map anatomical structures onto AMS trays.

The lab X2D is not networked (see the P3 plan: USB-only delivery), so nothing
here can ask the printer what is loaded. The operator declares the trays and
this module assigns structures to them — which means every way the declaration
can disagree with the request has to come back as a warning the operator reads,
never as a silent adjustment. A structure that quietly loses its slot prints in
its neighbour's colour, and a two-tone anatomy the surgeon is meant to read as
"tumour here, parenchyma there" arrives as one solid object.

Slots are 0-based throughout, matching `report.read_stats`.
"""
from pathlib import Path

# AMS 2 Pro holds four spools per unit.
DEFAULT_CAPACITY = 4

# Enough of a table to cover what a lab keeps on the shelf. An unrecognised
# name is not an error - it is a warning plus the first free tray, because the
# operator can still see the colour they actually loaded in the plan.
COLOUR_HEX = {
    "red": "#FF0000",
    "white": "#FFFFFF",
    "black": "#000000",
    "green": "#00AE42",
    "blue": "#0066FF",
    "yellow": "#F4EE2A",
    "orange": "#FF6A13",
    "grey": "#808080",
    "gray": "#808080",
    "clear": "#F0F0F0",
    "natural": "#F5EBD9",
    "pink": "#F55A74",
    "purple": "#5E43B7",
    "brown": "#7C4B00",
}


def colour_hex(name: str) -> str:
    text = str(name or "").strip()
    if text.startswith("#"):
        return text.upper()
    return COLOUR_HEX.get(text.lower(), "")


def filament_profile_for(material: str, profiles: list[Path], support: bool = False) -> Path | None:
    """Resolve a Bambu filament profile by MATERIAL. Colour is a property of
    the tray, not of the profile - Bambu ships one profile per material."""
    from .slicer import filament_for

    return filament_for(material, list(profiles or []), support=support)


def plan_slots(
    mapping: dict[str, str],
    available: list[dict],
    *,
    capacity: int = DEFAULT_CAPACITY,
    profiles: list[Path] | None = None,
    support_material: str | None = None,
    use_aux_nozzle: bool = False,
) -> dict:
    """Assign each structure a tray.

    `mapping` is `{structure: colour}` in the order the operator wants them
    considered; `available` is the declared trays, in AMS order, as
    `{"type": "PLA", "colour": "red"}`.
    """
    trays = list(available or [])
    if not trays:
        raise ValueError(
            "No AMS trays declared. Say what is loaded (for example "
            '[{"type": "PLA", "colour": "red"}, ...]) before mapping structures.'
        )
    usable = min(len(trays), capacity)

    warnings: list[str] = []
    if len(trays) > capacity:
        warnings.append(f"{len(trays)} trays declared but only {capacity} can be used; the rest are ignored.")

    taken: set[int] = set()
    slots: list[dict] = []
    unassigned: list[str] = []

    def free_tray() -> int | None:
        return next((i for i in range(usable) if i not in taken), None)

    def reserve(colour: str, label: str) -> int | None:
        wanted = str(colour or "").strip().lower()
        match = next(
            (i for i in range(usable)
             if i not in taken and str(trays[i].get("colour", "")).strip().lower() == wanted),
            None,
        )
        if match is not None:
            taken.add(match)
            return match
        fallback = free_tray()
        if fallback is None:
            return None
        loaded = {str(t.get("colour", "")).strip().lower() for t in trays[:usable]}
        if wanted in loaded:
            warnings.append(
                f"{label}: the only {colour} tray is already assigned; "
                f"using slot {fallback} ({trays[fallback].get('colour', '?')}) instead."
            )
        else:
            warnings.append(
                f"{label}: no tray holds {colour}; "
                f"using slot {fallback} ({trays[fallback].get('colour', '?')}) instead."
            )
        taken.add(fallback)
        return fallback

    # Support on the aux nozzle is reserved BEFORE the structures only when it
    # would compete for a tray; on the aux nozzle it never does.
    support: dict | None = None
    if support_material and not use_aux_nozzle:
        # Same-material support shares the main nozzle and needs its own tray,
        # so it is booked after the anatomy, below.
        support = {"material": support_material, "nozzle": "main", "slot": None}
    elif support_material:
        support = {
            "material": support_material,
            "nozzle": "aux",
            "slot": None,
            "filament_profile": _profile_path(support_material, profiles, support=True),
        }

    for structure, colour in (mapping or {}).items():
        slot = reserve(colour, structure)
        if slot is None:
            unassigned.append(structure)
            continue
        tray = trays[slot]
        actual = str(tray.get("colour", ""))
        slots.append({
            "slot": slot,
            "structure": structure,
            "colour": actual,
            "hex": colour_hex(actual),
            "type": tray.get("type", ""),
            "filament_profile": _profile_path(tray.get("type", ""), profiles),
        })

    if unassigned:
        warnings.append(
            f"{len(unassigned)} structure(s) have no tray: {', '.join(unassigned)}. "
            f"Only {usable} slots are available - load more filament or merge structures."
        )

    if support and support["nozzle"] == "main":
        slot = free_tray()
        if slot is None:
            warnings.append(
                f"Same-material support needs its own tray and none is free; "
                f"either free a slot or print support on the aux nozzle."
            )
        else:
            taken.add(slot)
            support["slot"] = slot
            support["filament_profile"] = _profile_path(support_material, profiles, support=True)

    return {"slots": slots, "unassigned": unassigned, "support": support, "warnings": warnings}


def _profile_path(material: str, profiles: list[Path] | None, support: bool = False) -> str:
    if not profiles or not material:
        return ""
    chosen = filament_profile_for(material, profiles, support=support)
    return str(chosen) if chosen else ""
