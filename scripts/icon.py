"""Generate the project's simple database glyph (Pillow required only to regenerate)."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / "desktop" / "build"
out.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (1024, 1024))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((16, 16, 1008, 1008), radius=220, fill="#0065ff")
for top in (250, 410, 570):
    draw.arc((250, top, 774, top+200), 0, 180, fill="white", width=44)
draw.line((250, 350, 250, 670), fill="white", width=44)
draw.line((774, 350, 774, 670), fill="white", width=44)
draw.ellipse((250, 250, 774, 450), outline="white", width=44)
image.save(out / "icon.png")
image.save(out / "icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
