"""Write the Somatic mark into the desktop app's icon set."""
import os, sys
from somatic_logo import draw_mark

dest = sys.argv[1]
plan = {
    "icon.png": 1024,
    "32x32.png": 32,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "dock.png": 512,
    # Windows Store tiles, kept consistent so nothing shows the old mark.
    "Square30x30Logo.png": 30, "Square44x44Logo.png": 44, "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89, "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150, "Square284x284Logo.png": 284, "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}
for name, size in plan.items():
    path = os.path.join(dest, name)
    if not os.path.exists(path):
        continue  # only replace what the app already ships
    draw_mark(size).save(path)
    print("wrote", name, size)

draw_mark(256).save(
    os.path.join(dest, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("wrote icon.ico (7 sizes)")
