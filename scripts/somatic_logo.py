"""Somatic mark: a solid body rendered as stacked slices.

The product's whole job is turning stacked scan slices into stacked print
layers, so the mark is one idea doing both: a rounded body form built from
horizontal bands. Reads as a CT cross-section and as print layers at once,
and stays legible at 16px because it is only bands.
"""
import math
from PIL import Image, ImageDraw

BG = (14, 22, 25, 255)        # deep slate, clinical rather than techy
BAND = (232, 242, 241, 255)   # bone white
ACCENT = (45, 212, 191, 255)  # the slice under inspection

def bands_for(size):
    """Fewer, thicker bands as the icon shrinks. Nine bands is a dot at 16px:
    below ~48 the gaps stop resolving and the mark turns into a blob."""
    if size >= 128:
        return 9
    if size >= 64:
        return 7
    if size >= 32:
        return 5
    return 4


def draw_mark(size, bg=True, pad_ratio=0.20, bands=None):
    bands = bands or bands_for(size)
    # 4x supersample, then downscale: gives clean edges without AA artefacts.
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        r = int(S * 0.225)  # squircle-ish corner, matches modern app icons
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=BG)

    pad = S * (pad_ratio if size >= 64 else 0.15)
    box = S - 2 * pad
    cx = S / 2
    cy = S / 2
    R = box / 2

    gap = box / bands * (0.30 if bands >= 7 else 0.24)
    band_h = (box - gap * (bands - 1)) / bands
    focus = bands // 2

    for i in range(bands):
        top = pad + i * (band_h + gap)
        mid = top + band_h / 2
        dy = abs(mid - cy)
        if dy >= R:
            continue
        # Half-width follows the circle, so the stack reads as one solid form.
        hw = math.sqrt(max(R * R - dy * dy, 0.0))
        # Waist: pull the middle in slightly so it reads as a body, not a ball.
        hw *= 0.86 + 0.14 * (dy / R) ** 2
        if hw < band_h * 0.35:
            continue
        color = ACCENT if i == focus else BAND
        d.rounded_rectangle(
            [cx - hw, top, cx + hw, top + band_h],
            radius=band_h / 2,
            fill=color,
        )
    return img.resize((size, size), Image.LANCZOS)

if __name__ == "__main__":
    import sys, os
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    draw_mark(1024).save(os.path.join(out, "icon.png"))
    for s in (32, 64, 128, 256, 512):
        draw_mark(s).save(os.path.join(out, f"{s}.png"))
    draw_mark(1024, bg=False).save(os.path.join(out, "mark-transparent.png"))
    # Multi-resolution .ico: Windows picks the right one per context.
    draw_mark(256).save(
        os.path.join(out, "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("wrote", out)
