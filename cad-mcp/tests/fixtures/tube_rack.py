"""Parametric sample-tube rack (build123d algebra API)."""
from build123d import Box, Cylinder, Pos

PARAMS = {
    "rows":          {"default": 3,    "min": 1,  "max": 10,  "step": 1,   "unit": ""},
    "cols":          {"default": 4,    "min": 1,  "max": 12,  "step": 1,   "unit": ""},
    "tube_diameter": {"default": 13.0, "min": 6,  "max": 30,  "step": 0.5, "unit": "mm"},
    "hole_depth":    {"default": 25.0, "min": 5,  "max": 60,  "step": 1,   "unit": "mm"},
    "wall":          {"default": 4.0,  "min": 2,  "max": 10,  "step": 0.5, "unit": "mm"},
    "base":          {"default": 6.0,  "min": 3,  "max": 15,  "step": 0.5, "unit": "mm"},
}

def build(p):
    rows, cols = int(p["rows"]), int(p["cols"])
    d, depth, wall, base = p["tube_diameter"], p["hole_depth"], p["wall"], p["base"]
    pitch = d + wall
    width  = cols * pitch + wall
    length = rows * pitch + wall
    height = base + depth
    rack = Box(width, length, height)
    x0 = -width / 2 + wall + d / 2
    y0 = -length / 2 + wall + d / 2
    for r in range(rows):
        for c in range(cols):
            hole = Pos(x0 + c * pitch, y0 + r * pitch, height / 2 - depth / 2 + 0.01) \
                   * Cylinder(d / 2, depth + 0.02)
            rack -= hole
    return rack
