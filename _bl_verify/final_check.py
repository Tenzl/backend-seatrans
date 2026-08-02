import fitz
from PIL import Image

doc = fitz.open(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\sample-filled.pdf"
)
page = doc[0]
cells = {
    "placeOfReceipt": (240.25, 263.25),
    "oceanVessel": (263.25, 286.75),
    "portOfDischarge": (286.75, 309.0),
    "freight": (701.75, 725.5),
    "numOrig": (725.5, 750.25),
}
checks = [
    ("QUI NHON, VN (VNUIH)", "placeOfReceipt"),
    ("SITC MINHE", "oceanVessel"),
    ("2615N", "oceanVessel"),
    ("DA NANG, VN (VNDAD)", "oceanVessel"),
    ("HAKATA, FUKUOKA, JP (JPHKT)", "portOfDischarge"),
    ("AS ARRANGED", "freight"),
    ("THREE/3", "numOrig"),
    ("20 PALLET(S)", None),
]

spans = []
for b in page.get_text("dict")["blocks"]:
    if b.get("type") != 0:
        continue
    for line in b.get("lines", []):
        for s in line.get("spans", []):
            t = s["text"].strip()
            if t:
                spans.append((t, s["bbox"]))

for text, cell in checks:
    matches = [(t, bb) for t, bb in spans if t == text or text in t]
    if not matches:
        print("MISSING", text)
        continue
    if cell == "oceanVessel" and text.startswith("DA NANG"):
        matches = [(t, bb) for t, bb in matches if bb[1] < 400]
    if cell == "portOfDischarge":
        matches = [(t, bb) for t, bb in matches if bb[1] < 400]
    t, (x0, y0, x1, y1) = min(matches, key=lambda m: m[1][1])
    if cell is None:
        print(f"{text}: x={x0:.1f}-{x1:.1f} top={y0:.1f}")
        continue
    top, bot = cells[cell]
    ok = y0 >= top + 0.5 and y1 <= bot - 0.5
    status = "OK" if ok else "OUT"
    print(
        f"{text[:40]:40} {y0:.1f}-{y1:.1f} clearT={y0-top:.1f} "
        f"clearB={bot-y1:.1f} {status}"
    )

# freight payable lines
print("--- freight payable ---")
for t, (x0, y0, x1, y1) in spans:
    if y0 > 700 and y0 < 730 and x0 > 250 and x0 < 380 and t not in ("THREE/3",):
        if any(c.isalpha() for c in t):
            print(repr(t), f"top={y0:.1f} bot={y1:.1f} x={x0:.1f}")

mat = fitz.Matrix(2.2, 2.2)
pix = page.get_pixmap(matrix=mat, alpha=False)
pix.save(r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-fixed.png")
img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
s = 2.2
img.crop((int(55 * s), int(235 * s), int(380 * s), int(340 * s))).save(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-transport.png"
)
img.crop((int(55 * s), int(305 * s), int(590 * s), int(390 * s))).save(
    r"d:\University\Seatrans-website\seatrans\backend2.0\_bl_verify\ours-cargo.png"
)
print("saved previews")
