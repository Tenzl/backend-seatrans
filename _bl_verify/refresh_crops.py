import fitz
from PIL import Image
import numpy as np

doc = fitz.open(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\sample-filled.pdf"
)
page = doc[0]
print("key spans:")
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if not t:
                continue
            x0, y0, x1, y1 = s["bbox"]
            if any(
                k in t
                for k in (
                    "PALLET",
                    "2615",
                    "QUI",
                    "SITC",
                    "HAKATA",
                    "FCL",
                    "AS ARR",
                    "THREE",
                    "DA NANG",
                )
            ) or t in ("20", "X"):
                print(
                    repr(t),
                    "top",
                    round(y0, 1),
                    "bot",
                    round(y1, 1),
                    "x",
                    round(x0, 1),
                    "x1",
                    round(x1, 1),
                )

mat = fitz.Matrix(2.5, 2.5)
pix = page.get_pixmap(matrix=mat, alpha=False)
img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
s = 2.5
img.crop((int(55 * s), int(235 * s), int(380 * s), int(340 * s))).save(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-transport.png"
)
img.crop((int(55 * s), int(305 * s), int(590 * s), int(400 * s))).save(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-cargo.png"
)
img.crop((int(55 * s), int(695 * s), int(590 * s), int(820 * s))).save(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-footer.png"
)
print("crops saved")

# Find checkbox squares on blank in insurance row
blank = Image.open(
    r"d:\University\Seatrans-website\seatrans\dashboard_admin\public\BL\non-negotiable.png"
).convert("RGB")
a4w, a4h = 595.28, 841.89
scale = 4
blank = blank.resize(
    (int(round(a4w * scale)), int(round(a4h * scale))), Image.Resampling.LANCZOS
)
gray = np.array(blank.convert("L"))
# insurance row ~725-750
y0, y1 = int(728 * scale), int(748 * scale)
x0, x1 = int(60 * scale), int(250 * scale)
region = gray[y0:y1, x0:x1]
# find dark vertical edges of small boxes
dark = region < 100
# print x columns with vertical ink
col = dark.sum(axis=0)
for x in range(len(col)):
    if col[x] > 8:
        print("ink x", round((x0 + x) / scale, 1), "count", int(col[x]))
