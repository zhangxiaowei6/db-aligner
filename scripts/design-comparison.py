"""Pair approved mockups with CUA-captured UI screenshots for visual QA.

Usage: python scripts/design-comparison.py --references <approved-image-directory>
Pillow is only required to regenerate the comparison evidence, not to build the app.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("--references", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
shots = root / "docs" / "screenshots"
pairs = {
    "structure-diff": "9fe8eff8-198e-4a25-a6a2-f1dbf3d922b1",
    "data-diff": "4f229568-fe4a-43be-9e61-0a0f39580d7c",
    "table-view": "e4627c79-1b7f-4653-ae6e-b89801aeff00",
    "workspaces": "81be4809-7d7e-4fe1-834e-a89e1f40356d",
    "connections": "28e1e82f-58cd-4486-a9f9-059b20ffb51a",
    "import": "3057174f-7bec-4885-a37c-51eaae7905b9",
    "scope": "2cebb3bf-42e3-44b1-b95b-f3ef538004f2",
    "templates": "24d8cf24-5443-4ad1-b89d-668cda5aa481",
    "execution-result": "e6801b82-4ff5-47b4-abbc-8544c5d58791",
    "record-save-only": "843bd1e9-e430-43c7-9b96-bf127968daf0",
    "version-drawer": "9c5db8bb-f1d3-487a-a126-612a5b9ee4d6",
    "versions": "e0ca19a0-e800-4b85-b554-33c56074fbf7",
    "rollback": "030fbba1-45d9-4bb1-b8d5-f1b0c921fc6c",
    "export-default": "28976439-3548-420f-902d-dd97b0d86c75",
    "settings": "a90a2704-85f5-4f11-bd53-0bcc0b6ba494",
}
for name, ref in pairs.items():
    source = Image.open(args.references / f"exec-{ref}.png").convert("RGB")
    actual = Image.open(shots / f"{name}.png").convert("RGB")
    width, height = actual.size
    canvas = Image.new("RGB", (width * 2, height + 32), "#f0f2f5")
    canvas.paste(source.resize((width, height), Image.Resampling.LANCZOS), (0, 32))
    canvas.paste(actual, (width, 32))
    draw = ImageDraw.Draw(canvas)
    draw.text((16, 9), f"Approved reference | {source.size}", fill="#303133")
    draw.text((width + 16, 9), f"Implemented UI | {actual.size} | {name}", fill="#303133")
    canvas.save(shots / f"{name}-comparison.jpg", quality=90)
print(f"Created {len(pairs)} reference / screenshot pairs")
groups = {
    "core": ["structure-diff", "data-diff", "table-view"],
    "setup": ["workspaces", "connections", "import", "scope"],
    "records": ["version-drawer", "versions", "record-save-only", "execution-result"],
    "tools": ["templates", "rollback", "export-default", "settings"],
}
for name, members in groups.items():
    images = [Image.open(shots / f"{member}-comparison.jpg").resize((1488, 544), Image.Resampling.LANCZOS) for member in members]
    sheet = Image.new("RGB", (1488, 544 * len(images)), "white")
    for i, img in enumerate(images):
        sheet.paste(img, (0, i * 544))
    sheet.save(shots / f"qa-{name}.jpg", quality=94)
