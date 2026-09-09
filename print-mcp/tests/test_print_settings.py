"""The adjustable print settings and the floors that keep them safe.

These are the tests that stop a part being quietly hollowed out. The refusal
cases matter more than the happy path: an operator who asks for 5% infill on an
orthosis must be told no, not handed 25% under the name they asked for.
"""
import pytest
from coder3d_print import print_settings as ps


class TestVocabulary:
    def test_only_known_settings_are_accepted(self):
        # A free-form patch over a template could swap the machine or the
        # filament, so anything not on the list is refused by name.
        with pytest.raises(ps.UnknownSetting) as excinfo:
            ps.resolve({"printer_model": "Bambu Lab A1"}, "display")
        assert "printer_model" in str(excinfo.value)

    def test_every_knob_maps_to_a_real_slicer_key(self):
        described = ps.describe()
        assert set(described) == set(ps.KNOBS)
        assert described["infill_density"]["slicer_key"] == "sparse_infill_density"
        assert described["supports"]["slicer_key"] == "enable_support"

    def test_values_come_out_in_the_string_forms_bambu_stores(self):
        patch = ps.resolve(
            {"infill_density": 12, "walls": 3, "layer_height": 0.2, "supports": True},
            "display",
        )["patch"]
        assert patch == {
            "sparse_infill_density": "12%",
            "wall_loops": "3",
            "layer_height": "0.2",
            "enable_support": "1",
        }

    def test_a_percent_sign_is_accepted_as_well_as_a_number(self):
        assert ps.resolve({"infill_density": "20%"}, "display")["patch"] == {"sparse_infill_density": "20%"}

    def test_an_unknown_infill_pattern_is_refused_with_the_choices(self):
        with pytest.raises(ps.UnknownSetting) as excinfo:
            ps.resolve({"infill_pattern": "spaghetti"}, "display")
        assert "gyroid" in str(excinfo.value)


class TestFloors:
    def test_a_display_model_may_be_hollowed_out(self):
        # Anatomy for teaching is looked at, not loaded, so cheap is fine.
        patch = ps.resolve({"infill_density": 5, "infill_pattern": "lightning"}, "teaching")["patch"]
        assert patch["sparse_infill_density"] == "5%"

    @pytest.mark.parametrize("use", ["prosthetic", "orthotic", "load-bearing", "surgical-guide", "fixture"])
    def test_a_load_bearing_part_cannot_be_thinned_below_the_floor(self, use):
        with pytest.raises(ps.UnsafeSetting) as excinfo:
            ps.resolve({"infill_density": 8}, use)
        message = str(excinfo.value)
        assert "25" in message and use in message

    def test_the_refusal_says_what_to_do_instead(self):
        with pytest.raises(ps.UnsafeSetting) as excinfo:
            ps.resolve({"walls": 1}, "orthotic")
        assert "display model" in str(excinfo.value)

    def test_at_the_floor_exactly_is_allowed(self):
        assert ps.resolve({"infill_density": 25}, "orthotic")["patch"] == {"sparse_infill_density": "25%"}

    def test_thick_layers_are_capped_harder_on_a_loaded_part(self):
        # Layer adhesion is where a loaded part breaks, so the ceiling is lower.
        assert ps.resolve({"layer_height": 0.28}, "display")["patch"] == {"layer_height": "0.28"}
        with pytest.raises(ps.UnsafeSetting) as excinfo:
            ps.resolve({"layer_height": 0.28}, "prosthetic")
        assert "0.24" in str(excinfo.value)

    def test_a_value_outside_the_knob_range_is_refused_whatever_the_use(self):
        with pytest.raises(ps.UnsafeSetting):
            ps.resolve({"infill_density": 140}, "display")
        with pytest.raises(ps.UnsafeSetting):
            ps.resolve({"walls": 99}, "display")


class TestIntendedUse:
    def test_the_category_mirrors_the_gate(self):
        assert ps.category("orthotic") == "load-bearing"
        assert ps.category("anatomy") == "display"

    def test_settings_cannot_be_changed_without_saying_what_the_part_is_for(self):
        # The intended use is what decides how thin the part may be made, so
        # there is no sensible default to fall back on.
        with pytest.raises(ps.UnsafeSetting) as excinfo:
            ps.resolve({"infill_density": 10}, "")
        assert "intended_use" in str(excinfo.value)

    def test_an_unrecognised_use_is_refused_rather_than_treated_as_display(self):
        with pytest.raises(ps.UnsafeSetting):
            ps.resolve({"infill_density": 10}, "ornament")


def test_nothing_requested_changes_nothing():
    assert ps.resolve({}, "display") == {"patch": {}, "applied": {}, "category": "display"}
