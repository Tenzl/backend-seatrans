import fitz
from PIL import Image, ImageDraw
import numpy as np

doc = fitz.open(r"d:\University\Seatrans-website\seatrans\dashboard_admin\public\BL\FILLED UP_ SUR BL.pdf")
page = doc[0]
keys = ("QUI NHON", "SITC MINHE", "2615N", "DA NANG", "HAKATA", "FCL/FCL", "AS ARRANGED", "THREE/3", "STVN", "20 PALLET", "20,700", "7.26")
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if any(k in t for k in keys):
                x0, y0, x1, y1 = s["bbox"]
                print(
                    f"{t[:40]!r:42} top={y0:7.2f} bot={y1:7.2f} h={y1-y0:5.2f} "
                    f"sz={s['size']:5.1f} x={x0:7.2f}"
                )

# Overlay sample text boxes shifted by -7.5 onto blank
blank = Image.open(
    r"d:\University\Seatrans-website\seatrans\dashboard_admin\public\BL\non-negotiable.png"
).convert("RGB")
a4w, a4h = 595.28, 841.89
scale = 2
W, H = int(a4w * scale), int(a4h * scale)
blank = blank.resize((W, H), Image.Resampling.LANCZOS)
draw = ImageDraw.Draw(blank)

shift = -7.5
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if not t:
                continue
            x0, y0, x1, y1 = s["bbox"]
            y0 += shift
            y1 += shift
            draw.rectangle(
                [x0 * scale, y0 * scale, x1 * scale, y1 * scale],
                outline=(255, 0, 0),
                width=2,
            )

for ypt in [102, 171.5, 240.25, 263.25, 286.75, 309, 572.5, 701.5, 725.5, 750.25]:
    y = int(ypt * scale)
    draw.line([(55 * scale, y), (560 * scale, y)], fill=(0, 200, 0), width=2)

out = r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\sample-shifted-on-blank.png"
blank.save(out)
print("saved", out)

# Blank vs sample grid delta
mat = fitz.Matrix(2, 2)
pix = page.get_pixmap(matrix=mat, alpha=False)
sample = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def hlines(img, y0, y1, thresh=140):
    arr = np.array(img.convert("L"))
    dark = arr < thresh
    region = dark[int(y0 * 2) : int(y1 * 2), 110:740]
    row = region.sum(axis=1)
    need = int(0.4 * 630)
    hits = []
    i = 0
    while i < len(row):
        if row[i] >= need:
            j = i
            best = i
            bestv = row[i]
            while j < len(row) and row[j] >= need * 0.5:
                if row[j] > bestv:
                    best, bestv = j, row[j]
                j += 1
            hits.append(y0 + best / 2)
            i = j
        else:
            i += 1
    return hits


print("sample transport", hlines(sample, 230, 330))
blank_full = Image.open(
    r"d:\University\Seatrans-website\seatrans\dashboard_admin\public\BL\non-negotiable.png"
).convert("RGB")
blank_full = blank_full.resize(sample.size, Image.Resampling.LANCZOS)
print("blank transport", hlines(blank_full, 230, 330, thresh=90))
