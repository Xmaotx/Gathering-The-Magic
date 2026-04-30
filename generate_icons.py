"""Generate PWA icons for Gathering the Magic.

Draws a stylized 5-color MTG mana wheel on a dark plum background — the same
palette used inside the game (W=parchment, U=blue, B=plum, R=red, G=green).
We produce three PNGs:
  - icon-192.png   (any-purpose, 192x192)
  - icon-512.png   (any-purpose, 512x512)
  - icon-maskable.png (maskable, 512x512 with safe-zone padding)

Maskable icons are letter-boxed so they survive the round/squircle/square
crops that Android applies on the home screen — content is kept inside the
inner 80% safe zone.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import math

OUT = Path(__file__).resolve().parent / "public"
OUT.mkdir(exist_ok=True)

# Palette mirrors COLOR_HEX inside the game so the icon feels on-brand.
COLOR_HEX = {
    "W": (243, 227, 168),
    "U": (108, 184, 224),
    "B": (138, 122, 146),
    "R": (224, 109, 90),
    "G": (111, 176, 111),
}
ORDER = ["W", "U", "B", "R", "G"]
BG = (26, 20, 40)        # matches theme_color from the manifest
RIM = (138, 122, 168)


def draw_icon(size: int, safe_fraction: float = 1.0) -> Image.Image:
    """Render the mana-wheel icon at the requested size.

    safe_fraction < 1 shrinks the artwork inside a transparent margin so the
    Android maskable crop doesn't chop the petals.
    """
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img, "RGBA")

    cx = cy = size / 2
    # Wheel radius. We back off from the edge so the rim stroke isn't clipped,
    # then shrink further for maskable icons via safe_fraction.
    base_radius = (size / 2) * 0.92 * safe_fraction
    inner_radius = base_radius * 0.32

    # Draw five wedges. Each color owns 72°, starting from the top (-90°)
    # going clockwise: W → U → B → R → G — matching the in-game wheel.
    start_angle = -90 - 36   # rotate so White is centered at the top
    for i, key in enumerate(ORDER):
        a0 = start_angle + i * 72
        a1 = a0 + 72
        # Pillow's pieslice draws filled wedges from a bounding box.
        bbox = [cx - base_radius, cy - base_radius, cx + base_radius, cy + base_radius]
        draw.pieslice(bbox, a0, a1, fill=COLOR_HEX[key], outline=BG, width=max(2, size // 96))

    # Inner dark disc (the mana symbols on a real card sit on a circle).
    draw.ellipse(
        [cx - inner_radius, cy - inner_radius, cx + inner_radius, cy + inner_radius],
        fill=BG,
        outline=RIM,
        width=max(2, size // 96),
    )

    # Five small color dots inside the inner disc — cluster them so the
    # icon reads even at favicon size.
    dot_r = inner_radius * 0.28
    dot_orbit = inner_radius * 0.55
    for i, key in enumerate(ORDER):
        # Mirror the wedge orientation: dots line up with their wedges.
        ang = math.radians(-90 + i * 72)
        dx = cx + dot_orbit * math.cos(ang)
        dy = cy + dot_orbit * math.sin(ang)
        draw.ellipse([dx - dot_r, dy - dot_r, dx + dot_r, dy + dot_r], fill=COLOR_HEX[key])

    # Outer rim.
    draw.ellipse(
        [cx - base_radius, cy - base_radius, cx + base_radius, cy + base_radius],
        outline=RIM,
        width=max(3, size // 64),
    )
    return img


# any-purpose icons fill the canvas
draw_icon(192, safe_fraction=1.0).save(OUT / "icon-192.png")
draw_icon(512, safe_fraction=1.0).save(OUT / "icon-512.png")
# maskable icon respects the 80% safe zone so the OS can crop freely
draw_icon(512, safe_fraction=0.80).save(OUT / "icon-maskable.png")
# apple-touch-icon — 180x180 is Apple's preferred size
draw_icon(180, safe_fraction=1.0).save(OUT / "apple-touch-icon.png")

print(f"Wrote icons to {OUT}")
