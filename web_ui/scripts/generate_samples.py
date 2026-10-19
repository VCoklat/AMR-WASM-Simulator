"""Generate contoh gambar diorama lorong gudang (tampak atas) untuk demo tanpa webcam.

Lorong 2 kolom x 4 baris berada di x 200-440, y 40-440 pada kanvas 640x480,
sama dengan preset kalibrasi di VisionPanel. Jalankan: python3 scripts/generate_samples.py
"""
import math
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

W, H = 640, 480
X0, Y0, X1, Y1 = 200, 40, 440, 440
COLS, ROWS = 2, 4
CW, CH = (X1 - X0) // COLS, (Y1 - Y0) // ROWS
OUT = Path(__file__).resolve().parent.parent / "public" / "samples"


def base(seed=0):
    rnd = random.Random(seed)
    img = Image.new("RGB", (W, H), (150, 150, 145))
    d = ImageDraw.Draw(img)
    for _ in range(5000):  # tekstur lantai beton
        x, y = rnd.randrange(W), rnd.randrange(H)
        g = rnd.randint(135, 165)
        d.point((x, y), fill=(g, g, g - 4))
    # rak di kiri dan kanan lorong
    for rx in (40, 470):
        d.rectangle([rx, 30, rx + 130, 450], fill=(70, 90, 120))
        for yy in range(40, 450, 52):
            d.rectangle([rx + 8, yy, rx + 122, yy + 40], fill=(196, 160, 110))
    # lantai lorong + garis kuning batas sel
    d.rectangle([X0, Y0, X1, Y1], fill=(165, 165, 160))
    for c in range(COLS + 1):
        d.line([X0 + c * CW, Y0, X0 + c * CW, Y1], fill=(230, 190, 30), width=3)
    for r in range(ROWS + 1):
        d.line([X0, Y0 + r * CH, X1, Y0 + r * CH], fill=(230, 190, 30), width=3)
    return img


def cell_center(c, r):
    return X0 + c * CW + CW // 2, Y0 + r * CH + CH // 2


def palet(d, c, r, angle=0):
    cx, cy = cell_center(c, r)
    for i in range(5):  # bilah kayu
        off = -36 + i * 18
        pts = [(-45, off - 6), (45, off - 6), (45, off + 6), (-45, off + 6)]
        rot = [(cx + x * math.cos(angle) - y * math.sin(angle), cy + x * math.sin(angle) + y * math.cos(angle)) for x, y in pts]
        d.polygon(rot, fill=(150, 100, 50), outline=(90, 60, 30))


def forklift(d, c, r):
    cx, cy = cell_center(c, r)
    d.rectangle([cx - 30, cy - 25, cx + 30, cy + 35], fill=(240, 190, 20), outline=(60, 50, 10), width=2)
    d.rectangle([cx - 18, cy - 12, cx + 18, cy + 15], fill=(40, 40, 40))  # kabin
    d.rectangle([cx - 22, cy - 45, cx - 14, cy - 25], fill=(90, 90, 90))  # garpu
    d.rectangle([cx + 14, cy - 45, cx + 22, cy - 25], fill=(90, 90, 90))
    for wx in (cx - 34, cx + 28):
        d.rectangle([wx, cy + 15, wx + 6, cy + 32], fill=(20, 20, 20))


def karung(d, c, r, angle=0):
    cx, cy = cell_center(c, r)
    pts = []
    for k in range(40):
        t = 2 * math.pi * k / 40
        x, y = 40 * math.cos(t), 28 * math.sin(t)
        pts.append((cx + x * math.cos(angle) - y * math.sin(angle), cy + x * math.sin(angle) + y * math.cos(angle)))
    d.polygon(pts, fill=(225, 210, 170), outline=(150, 130, 90))
    d.line([pts[0], pts[20]], fill=(170, 150, 110), width=2)


def kardus(d, c, r):
    cx, cy = cell_center(c, r)
    d.rectangle([cx - 35, cy - 30, cx + 35, cy + 30], fill=(185, 140, 85), outline=(110, 80, 40), width=2)
    d.line([cx - 35, cy, cx + 35, cy], fill=(220, 200, 150), width=6)


def save(img, name):
    img.filter(ImageFilter.GaussianBlur(0.6)).save(OUT / name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save(base(1), "01_kosong.png")
    img = base(2); palet(ImageDraw.Draw(img), 0, 1); save(img, "02_palet.png")
    img = base(3); d = ImageDraw.Draw(img); palet(d, 0, 1); forklift(d, 1, 2); save(img, "03_palet_forklift_penuh.png")
    img = base(4); kardus(ImageDraw.Draw(img), 1, 0); save(img, "04_kardus.png")
    for i, a in enumerate([0, 0.15, -0.15, 0.3, -0.3]):  # 5 sampel few-shot karung
        img = base(10 + i); karung(ImageDraw.Draw(img), 1, 3, a); save(img, f"05_karung_{i + 1}.png")
    img = base(20); karung(ImageDraw.Draw(img), 0, 2, 0.2); save(img, "06_karung_sel_lain.png")
    img = Image.new("RGB", (W, H), (8, 8, 8)); save(img, "07_lensa_tertutup.png")
    print("Contoh gambar ditulis ke", OUT)


if __name__ == "__main__":
    main()
