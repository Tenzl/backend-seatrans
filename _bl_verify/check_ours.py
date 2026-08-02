import fitz
from PIL import Image, ImageDraw
import numpy as np

pdf_path = r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\sample-filled.pdf"
doc = fitz.open(pdf_path)
page = doc[0]

keys = [
    "QUI NHON",
    "SITC MINHE",
    "2615N",
    "DA NANG",
    "HAKATA",
    "FCL/FCL",
    "20 PALLET",
    "20,700",
    "7.26",
    "AS ARRANGED",
    "THREE/3",
    "AN THINH",
    "SEKIGAHARA",
    "AT SHIPPER",
    "STVN",
    "FREIGHT COLLECT",
    "CLEAN ON BOARD",
    "APEX",
]
print("=== OUR RENDERED TEXT BBOXES ===")
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if any(k in t for k in keys):
                x0, y0, x1, y1 = s["bbox"]
                print(
                    f"{t[:45]!r:48} top={y0:7.2f} bot={y1:7.2f} "
                    f"x={x0:7.2f} sz={s['size']:5.1f}"
                )

# Overlay our text boxes + blank grid on rendered page
mat = fitz.Matrix(2, 2)
pix = page.get_pixmap(matrix=mat, alpha=False)
img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
draw = ImageDraw.Draw(img)
scale = 2

# blank grid lines (known)
for ypt in [102, 171.5, 240.25, 263.25, 286.75, 309, 572.5, 701.75, 725.5, 750.25]:
    y = int(ypt * scale)
    draw.line([(50 * scale, y), (560 * scale, y)], fill=(0, 220, 0), width=2)

# highlight key field boxes in red from actual spans
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if any(k in t for k in keys):
                x0, y0, x1, y1 = s["bbox"]
                draw.rectangle(
                    [x0 * scale, y0 * scale, x1 * scale, y1 * scale],
                    outline=(255, 0, 0),
                    width=2,
                )

out = r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-measured.png"
img.save(out)
print("saved", out)

# Compare to cell interiors
cells = {
    "placeOfReceipt": (240.25, 263.25),
    "oceanVessel": (263.25, 286.75),
    "portOfDischarge": (286.75, 309.0),
    "freightAmount": (701.75, 725.5),
    "numOrig": (725.5, 750.25),
}
print("\n=== CELL FIT CHECK ===")
checks = [
    ("QUI NHON, VN (VNUIH)", "placeOfReceipt"),
    ("SITC MINHE", "oceanVessel"),
    ("2615N", "oceanVessel"),
    ("DA NANG, VN (VNDAD)", "oceanVessel"),  # port loading same row
    ("AS ARRANGED", "freightAmount"),
    ("THREE/3", "numOrig"),
]
# re-find
spans = {}
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            spans[t] = s["bbox"]

for text, cell in checks:
    if text not in spans:
        # fuzzy
        match = next((k for k in spans if text in k), None)
        if not match:
            print(f"missing {text}")
            continue
        text = match
    x0, y0, x1, y1 = spans[text]
    top, bot = cells[cell]
    ok = y0 >= top + 1 and y1 <= bot - 1
    print(
        f"{text[:40]:40} cell {top}-{bot}: glyph {y0:.1f}-{y1:.1f} "
        f"{'OK' if ok else 'OUT'} clear_top={y0-top:.1f} clear_bot={bot-y1:.1f}"
    )
