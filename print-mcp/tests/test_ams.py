from pathlib import Path

import pytest
from coder3d_print import ams

# Four trays, the AMS 2 Pro's capacity, as the operator declares them.
TRAYS = [
    {"type": "PLA", "colour": "red"},
    {"type": "PLA", "colour": "white"},
    {"type": "PLA", "colour": "green"},
    {"type": "PLA", "colour": "black"},
]

PROFILES = [
    Path("Bambu PLA Basic @BBL X2D 0.4 nozzle.json"),
    Path("Bambu ABS @BBL X2D 0.4 nozzle.json"),
    Path("Bambu Support For PLA @BBL X2D 0.4 nozzle.json"),
]


def test_structures_take_distinct_slots_in_declaration_order():
    plan = ams.plan_slots({"tumour": "red", "parenchyma": "white"}, TRAYS)
    assert [s["slot"] for s in plan["slots"]] == [0, 1]
    assert [s["structure"] for s in plan["slots"]] == ["tumour", "parenchyma"]
    assert plan["warnings"] == []


def test_a_structure_takes_the_tray_holding_its_colour():
    """The operator loaded green in tray 2; asking for green must print green,
    not whatever happens to sit in the next free slot."""
    plan = ams.plan_slots({"tumour": "green"}, TRAYS)
    assert plan["slots"][0]["slot"] == 2
    assert plan["slots"][0]["colour"] == "green"


def test_two_structures_cannot_share_one_tray():
    plan = ams.plan_slots({"tumour": "red", "vessel": "red"}, TRAYS)
    assert [s["slot"] for s in plan["slots"]] == [0, 1]
    assert any("red" in w for w in plan["warnings"])


def test_more_structures_than_slots_warns_rather_than_dropping_silently():
    """A dropped structure prints as part of its neighbour - the surgeon sees
    one solid object where two were meant to be told apart."""
    mapping = {f"s{i}": c for i, c in enumerate(["red", "white", "green", "black", "blue"])}
    plan = ams.plan_slots(mapping, TRAYS)
    assert len(plan["slots"]) == 4
    assert plan["unassigned"] == ["s4"]
    assert any("s4" in w for w in plan["warnings"])


def test_an_unknown_colour_falls_back_to_the_first_free_tray_with_a_warning():
    plan = ams.plan_slots({"tumour": "chartreuse"}, TRAYS)
    assert plan["slots"][0]["slot"] == 0
    assert plan["slots"][0]["colour"] == "red"
    assert any("chartreuse" in w for w in plan["warnings"])


def test_support_on_the_aux_nozzle_never_consumes_a_colour_slot():
    """The X2D's second nozzle carries support; letting it book an AMS tray
    would cost a colour the anatomy needs."""
    plan = ams.plan_slots(
        {"tumour": "red", "parenchyma": "white", "vessel": "green", "bone": "black"},
        TRAYS,
        support_material="PLA",
        use_aux_nozzle=True,
    )
    assert [s["slot"] for s in plan["slots"]] == [0, 1, 2, 3]
    assert plan["support"]["nozzle"] == "aux"
    assert plan["support"]["slot"] is None
    assert plan["unassigned"] == []


def test_same_material_support_does_take_a_slot():
    plan = ams.plan_slots({"tumour": "red"}, TRAYS, support_material="PLA", use_aux_nozzle=False)
    assert plan["support"]["nozzle"] == "main"
    assert plan["support"]["slot"] == 1


def test_no_trays_declared_is_an_error_not_an_empty_plan():
    with pytest.raises(ValueError):
        ams.plan_slots({"tumour": "red"}, [])


def test_filament_profile_resolves_by_material_not_by_colour():
    """Bambu names filament profiles per material; colour lives in the tray."""
    chosen = ams.filament_profile_for("PLA", PROFILES)
    assert chosen is not None and "Support" not in chosen.name
    assert ams.filament_profile_for("ABS", PROFILES).name.startswith("Bambu ABS")


def test_support_material_resolves_to_a_support_profile():
    chosen = ams.filament_profile_for("PLA", PROFILES, support=True)
    assert "Support" in chosen.name


def test_slots_carry_the_profile_the_slicer_will_be_handed():
    plan = ams.plan_slots({"tumour": "red"}, TRAYS, profiles=PROFILES)
    assert plan["slots"][0]["filament_profile"].endswith("Bambu PLA Basic @BBL X2D 0.4 nozzle.json")


def test_colours_carry_a_hex_the_preview_can_draw():
    plan = ams.plan_slots({"tumour": "red"}, TRAYS)
    assert plan["slots"][0]["hex"] == "#FF0000"
