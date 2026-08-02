from PIL import Image
import numpy as np

img = Image.open(
    r"d:\University\Seatrans-website\seatrans\dashboard_admin\public\BL\non-negotiable.png"
).convert("RGB")
a4w, a4h = 595.28, 841.89
scale = 4
W, H = int(round(a4w * scale)), int(round(a4h * scale))
img = img.resize((W, H), Image.Resampling.LANCZOS)
gray = np.array(img.convert("L"))
dark = gray < 100


def hlines(y0, y1, x0, x1, frac=0.35):
    region = dark[int(y0 * scale) : int(y1 * scale), int(x0 * scale) : int(x1 * scale)]
    row = region.sum(axis=1)
    need = int((x1 - x0) * scale * frac)
    hits = []
    i = 0
    while i < len(row):
        if row[i] >= need:
            j = i
            best, bestv = i, row[i]
            while j < len(row) and row[j] >= need * 0.5:
                if row[j] > bestv:
                    best, bestv = j, row[j]
                j += 1
            hits.append(y0 + best / scale)
            i = j
        else:
            i += 1
    return hits


def vlines(y0, y1, x0, x1, frac=0.2):
    region = dark[int(y0 * scale) : int(y1 * scale), int(x0 * scale) : int(x1 * scale)]
    col = region.sum(axis=0)
    need = int((y1 - y0) * scale * frac)
    hits = []
    i = 0
    while i < len(col):
        if col[i] >= need:
            j = i
            best, bestv = i, col[i]
            while j < len(col) and col[j] >= need * 0.5:
                if col[j] > bestv:
                    best, bestv = j, col[j]
                j += 1
            hits.append(x0 + best / scale)
            i = j
        else:
            i += 1
    return hits


def label_end(x0, x1, y0, y1):
    """Return approx end of first label ink band inside cell."""
    region = gray[int(y0 * scale) : int(y1 * scale), int(x0 * scale) : int(x1 * scale)]
    ink = (region < 140).sum(axis=1)
    # skip top border (~1pt), find first ink, then gap
    started = False
    first = None
    last = None
    for i, v in enumerate(ink):
        yp = y0 + i / scale
        if yp < y0 + 1.2:
            continue
        if v > 8:
            if not started:
                started = True
                first = yp
            last = yp
        elif started and v <= 2 and last and (last - first) > 3:
            # gap after label
            return first, last
    return first, last


print("outer H", hlines(20, 50, 55, 560, 0.5))
print("address H", hlines(90, 250, 55, 320, 0.35))
print("transport H", hlines(230, 320, 55, 370, 0.3))
print("cargo H top", hlines(300, 340, 55, 560, 0.4))
print("decl H", hlines(560, 640, 55, 560, 0.3))
print("footer H", hlines(690, 810, 55, 560, 0.3))
print("left V", vlines(40, 780, 50, 75, 0.1))
print("transport V", vlines(240, 310, 55, 380, 0.25))
print("footer V", vlines(700, 780, 55, 560, 0.2))
print("cargo V weak", vlines(320, 560, 55, 580, 0.06))

cells = [
    ("consignor", 65, 200, 36, 102),
    ("consignee", 65, 200, 102, 171.5),
    ("notify", 65, 200, 171.5, 240.25),
    ("placeOfReceipt", 200, 310, 240.25, 263.25),
    ("oceanVessel", 65, 160, 263.25, 286.75),
    ("portOfLoading", 200, 310, 263.25, 286.75),
    ("portOfDischarge", 65, 190, 286.75, 309),
    ("placeOfDelivery", 200, 310, 286.75, 309),
    ("freightAmount", 65, 240, 701.5, 725.5),
    ("freightPayable", 260, 370, 701.5, 725.5),
    ("placeIssue", 385, 500, 701.5, 725.5),
    ("numOrig", 260, 370, 725.5, 750.25),
    ("delivery", 65, 250, 750.25, 800),
]
print("\nSuggested value tops (label_end + 1.5):")
for name, x0, x1, y0, y1 in cells:
    first, last = label_end(x0, x1, y0, y1)
    if last:
        suggested = last + 1.5
        print(
            f"  {name:18} cell={y0:6.1f}-{y1:6.1f} label={first:.1f}-{last:.1f} "
            f"-> valueTop={suggested:.1f} room={y1 - suggested:.1f}"
        )
    else:
        print(f"  {name:18} no label")
