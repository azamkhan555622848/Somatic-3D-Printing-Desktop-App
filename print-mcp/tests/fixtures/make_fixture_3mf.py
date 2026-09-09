"""A tiny synthetic `.gcode.3mf` so the report parsers test without a slicer.

The two entries below are trimmed copies of what Bambu Studio actually writes:
`Metadata/slice_info.config` (the stats) and `Metadata/plate_1.gcode` (the bare
gcode). Real archives differ only in size.
"""
import zipfile
from pathlib import Path

SLICE_INFO = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header><header_item key="X-BBL-Client-Type" value="slicer"/></header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="prediction" value="4530"/>
    <metadata key="weight" value="61.24"/>
    <metadata key="support_used" value="true"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="printer_model_id" value="X2D"/>
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="#FF0000" used_m="12.34" used_g="41.2"/>
    <filament id="2" tray_info_idx="GFA01" type="PLA" color="#FFFFFF" used_m="6.01" used_g="20.04"/>
  </plate>
</config>
"""

GCODE = """;LAYER_CHANGE
;Z:0.2
G1 X10 Y10 E0.1
G1 X20 Y10 E0.2
G1 X20 Y20 E0.3
;LAYER_CHANGE
;Z:0.4
G1 X10 Y10 E0.4
G1 X20 Y20 E0.5
"""


def write_fixture(path: Path, slice_info: str = SLICE_INFO, gcode: str = GCODE) -> Path:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("Metadata/slice_info.config", slice_info)
        z.writestr("Metadata/plate_1.gcode", gcode)
        z.writestr("Metadata/project_settings.config", "{}")
    return path
