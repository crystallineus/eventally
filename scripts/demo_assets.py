"""Generate the fictional demo receipts and photos in demo-assets/.

Every business, phone number and license number here is made up; each receipt is stamped
"SAMPLE - FICTIONAL DEMO DATA". Photos are simple illustrations, not real photos.

Usage (needs Pillow and the DejaVu fonts):
    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow
    /tmp/venv/bin/python scripts/demo_assets.py demo-assets              # everything
    /tmp/venv/bin/python scripts/demo_assets.py demo-assets range-hood-receipt
"""

import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = "/usr/share/fonts/truetype/dejavu"
MONO, MONOB = f"{FONTS}/DejaVuSansMono.ttf", f"{FONTS}/DejaVuSansMono-Bold.ttf"
SANS, SANSB = f"{FONTS}/DejaVuSans.ttf", f"{FONTS}/DejaVuSans-Bold.ttf"
INK = (25, 25, 30)
STAMP = (170, 60, 60)


def font(path, size):
    return ImageFont.truetype(path, size)


def right(d, x, y, text, f, fill=INK):
    d.text((x - d.textlength(text, font=f), y), text, fill=fill, font=f)


def center(d, width, y, text, f, fill=INK):
    d.text(((width - d.textlength(text, font=f)) / 2, y), text, fill=fill, font=f)


def plumbing_receipt(out: Path):
    """Maya's plumber invoice: $180 labor + $54.86 parts + $5.14 tax on parts = $240.00."""
    W, H = 1100, 1450
    img = Image.new("RGB", (W, H), (252, 251, 247))
    d = ImageDraw.Draw(img)
    s, sb, m = font(SANS, 24), font(SANSB, 24), font(MONO, 26)

    d.rectangle((0, 0, W, 150), fill=(28, 74, 120))
    d.text((60, 35), "MAPLE LEAF PLUMBING & DRAIN", fill="white", font=font(SANSB, 44))
    d.text((60, 95), "1290 Alder Ave, San Jose, CA 95126  ·  (408) 555-0142", fill=(220, 230, 240), font=s)
    d.text((60, 180), "CSLB Lic. #1000000 (C-36)", fill=(80, 80, 80), font=s)
    right(d, W - 60, 180, "INVOICE", font(SANSB, 40))

    y = 250
    for k, v in [("Invoice #", "4471"), ("Service date", "10/21/2026"), ("Invoice date", "10/21/2026"), ("Technician", "J. Alvarez")]:
        d.text((660, y), k, fill=(90, 90, 90), font=s)
        right(d, W - 60, y, v, sb)
        y += 38
    d.text((60, 250), "BILL TO / SERVICE ADDRESS", fill=(90, 90, 90), font=s)
    for i, line in enumerate(["Maya Chen", "418 Maple Street, Apt 2B", "San Jose, CA 95112"]):
        d.text((60, 290 + i * 36), line, fill=INK, font=font(SANS, 26))

    y = 440
    d.rectangle((60, y, W - 60, y + 50), fill=(232, 238, 245))
    d.text((80, y + 12), "DESCRIPTION", font=sb, fill=INK)
    right(d, 700, y + 12, "QTY", sb)
    right(d, 850, y + 12, "RATE", sb)
    right(d, W - 80, y + 12, "AMOUNT", sb)
    y += 70
    rows = [
        ("Diagnose leak under kitchen sink; replace", "", "", ""),
        ("  corroded P-trap and slip-joint washers.", "", "", ""),
        ("Labor (hours)", "1.5", "120.00", "180.00"),
        ('1-1/2" PVC P-trap kit', "1", "41.98", "41.98"),
        ('Slip-joint washers & nuts, 1-1/2"', "2", "6.44", "12.88"),
    ]
    for desc, qty, rate, amount in rows:
        d.text((80, y), desc, font=font(SANS, 25), fill=INK)
        if qty:
            right(d, 700, y, qty, m)
            right(d, 850, y, rate, m)
            right(d, W - 80, y, amount, m)
        y += 46

    y += 10
    d.line((600, y, W - 60, y), fill=(150, 150, 150), width=2)
    y += 20
    for k, v, bold in [("Labor", "180.00", False), ("Parts", "54.86", False), ("Subtotal", "234.86", False),
                       ("Sales tax 9.375% (parts)", "5.14", False), ("TOTAL", "$240.00", True)]:
        d.text((620, y), k, font=font(SANSB, 32) if bold else s, fill=INK)
        right(d, W - 80, y, v, font(MONOB, 32) if bold else m)
        y += 48 if bold else 40

    y += 10
    d.rounded_rectangle((540, y, W - 60, y + 56), radius=8, outline=(30, 120, 60), width=3)
    paid = "PAID  ·  VISA ****1249  ·  10/21/2026"
    d.text(((540 + W - 60) / 2 - d.textlength(paid, font=sb) / 2, y + 14), paid, font=sb, fill=(30, 120, 60))

    d.text((60, 1180), "Warranty: 90 days on labor, manufacturer warranty on parts.", font=s, fill=(70, 70, 70))
    d.text((60, 1220), "Thank you for choosing Maple Leaf Plumbing & Drain!", font=s, fill=(70, 70, 70))
    center(d, W, H - 70, "SAMPLE – FICTIONAL DEMO DATA – NOT A REAL BUSINESS", font(SANSB, 22), fill=STAMP)
    img.rotate(-1.2, expand=True, fillcolor=(205, 205, 200)).save(out / "plumbing-receipt.jpg", quality=88)


def range_hood_receipt(out: Path):
    """Appliance repair: $95 service call + $55 labor + $31.48 parts + $2.95 tax on parts = $184.43."""
    W, H = 1100, 1500
    img = Image.new("RGB", (W, H), (253, 252, 249))
    d = ImageDraw.Draw(img)
    s, sb, m = font(SANS, 24), font(SANSB, 24), font(MONO, 26)

    d.rectangle((0, 0, W, 150), fill=(122, 54, 32))
    d.text((60, 35), "ALDER APPLIANCE CARE", fill="white", font=font(SANSB, 44))
    d.text((60, 95), "880 Alder Ave, San Jose, CA 95126  ·  (408) 555-0163", fill=(245, 225, 215), font=s)
    d.text((60, 180), "BHGS Reg. #A00000 (appliance repair)", fill=(80, 80, 80), font=s)
    right(d, W - 60, 180, "SERVICE INVOICE", font(SANSB, 36))

    y = 250
    for k, v in [("Invoice #", "AC-2291"), ("Service date", "10/22/2026"), ("Invoice date", "10/22/2026"), ("Technician", "R. Nguyen")]:
        d.text((660, y), k, fill=(90, 90, 90), font=s)
        right(d, W - 60, y, v, sb)
        y += 38
    d.text((60, 250), "BILL TO / SERVICE ADDRESS", fill=(90, 90, 90), font=s)
    for i, line in enumerate(["Maya Chen", "418 Maple Street, Apt 2B", "San Jose, CA 95112"]):
        d.text((60, 290 + i * 36), line, fill=INK, font=font(SANS, 26))

    y = 440
    d.text((60, y), "Appliance: range hood (over-the-range)", fill=INK, font=sb)
    d.text((60, y + 36), "Complaint: hood light does not turn on; fan works.", fill=INK, font=s)
    d.text((60, y + 70), "Found: burnt light socket, both bulbs failed. Replaced socket and bulbs; tested OK.", fill=INK, font=s)

    y = 590
    d.rectangle((60, y, W - 60, y + 50), fill=(244, 233, 227))
    d.text((80, y + 12), "DESCRIPTION", font=sb, fill=INK)
    right(d, 700, y + 12, "QTY", sb)
    right(d, 850, y + 12, "RATE", sb)
    right(d, W - 80, y + 12, "AMOUNT", sb)
    y += 70
    for desc, qty, rate, amount in [
        ("Service call / diagnosis", "1", "95.00", "95.00"),
        ("Labor (hours)", "0.5", "110.00", "55.00"),
        ("Range hood light socket assembly", "1", "18.50", "18.50"),
        ("LED appliance bulb, 40W equiv.", "2", "6.49", "12.98"),
    ]:
        d.text((80, y), desc, font=font(SANS, 25), fill=INK)
        right(d, 700, y, qty, m)
        right(d, 850, y, rate, m)
        right(d, W - 80, y, amount, m)
        y += 46

    y += 10
    d.line((600, y, W - 60, y), fill=(150, 150, 150), width=2)
    y += 20
    for k, v, bold in [("Service & labor", "150.00", False), ("Parts", "31.48", False), ("Subtotal", "181.48", False),
                       ("Sales tax 9.375% (parts)", "2.95", False), ("TOTAL", "$184.43", True)]:
        d.text((620, y), k, font=font(SANSB, 32) if bold else s, fill=INK)
        right(d, W - 80, y, v, font(MONOB, 32) if bold else m)
        y += 48 if bold else 40

    y += 10
    d.rounded_rectangle((540, y, W - 60, y + 56), radius=8, outline=(30, 120, 60), width=3)
    paid = "PAID  ·  VISA ****1249  ·  10/22/2026"
    d.text(((540 + W - 60) / 2 - d.textlength(paid, font=sb) / 2, y + 14), paid, font=sb, fill=(30, 120, 60))

    d.text((60, 1250), "Warranty: 90 days on parts and labor for this repair.", font=s, fill=(70, 70, 70))
    d.text((60, 1290), "Thank you for choosing Alder Appliance Care!", font=s, fill=(70, 70, 70))
    center(d, W, H - 70, "SAMPLE – FICTIONAL DEMO DATA – NOT A REAL BUSINESS", font(SANSB, 22), fill=STAMP)
    img.rotate(0.8, expand=True, fillcolor=(205, 205, 200)).save(out / "range-hood-receipt.jpg", quality=88)


def hardware_receipt(out: Path):
    """Tom's hardware-store receipt for screen repair materials: $41.14 + $3.86 tax = $45.00."""
    W, H = 640, 1500
    img = Image.new("RGB", (W, H), (250, 250, 248))
    d = ImageDraw.Draw(img)
    m, mb = font(MONO, 24), font(MONOB, 26)

    y = 40
    center(d, W, y, "ALDER STREET HARDWARE", font(MONOB, 34))
    y += 50
    for line in ["2045 Alder St, San Jose CA 95126", "(408) 555-0187", "Store #12  Reg 03  Cashier: Dana"]:
        center(d, W, y, line, m)
        y += 34
    y += 10
    center(d, W, y, "10/24/2026   4:17 PM", m)
    y += 44
    d.text((30, y), "-" * 40, font=m, fill=INK)
    y += 34
    for name, sku, price in [
        ("FIBERGLASS SCREEN 36X84 GRY", "0 49816 22031 7", "12.98"),
        ("SCREEN SPLINE .175 25FT", "0 49816 10425 9", "6.48"),
        ("SPLINE ROLLER TOOL", "0 49816 30012 4", "8.97"),
        ("SCREEN FRAME KIT 48IN WHT", "0 49816 41890 2", "12.71"),
    ]:
        d.text((30, y), name, font=m, fill=INK)
        right(d, W - 30, y, price, m)
        y += 30
        d.text((50, y), sku, font=font(MONO, 20), fill=(110, 110, 110))
        y += 36
    d.text((30, y), "-" * 40, font=m, fill=INK)
    y += 34
    for k, v, f in [("SUBTOTAL", "41.14", m), ("SALES TAX 9.375%", "3.86", m), ("TOTAL", "45.00", mb)]:
        d.text((30, y), k, font=f, fill=INK)
        right(d, W - 30, y, v, f)
        y += 38
    y += 10
    for line in ["MASTERCARD ****5520   45.00", "AUTH 08812K   CHIP READ", "", "ITEMS SOLD: 4"]:
        d.text((30, y), line, font=m, fill=INK)
        y += 34

    y += 20
    rng = random.Random(7)
    x = 70
    while x < W - 70:
        bar = rng.choice([2, 3, 4, 6])
        d.rectangle((x, y, x + bar, y + 90), fill=INK)
        x += bar + rng.choice([2, 3, 5])
    y += 110
    center(d, W, y, "TRX 1204-0312-7781", m)
    y += 50
    for line in ["Returns with receipt within 90 days.", "Thank you for shopping local!"]:
        center(d, W, y, line, m)
        y += 34
    y += 30
    center(d, W, y, "SAMPLE - FICTIONAL DEMO DATA", font(MONOB, 22), fill=STAMP)

    img = img.crop((0, 0, W, y + 60))
    bg = Image.new("RGB", (W + 160, img.height + 160), (90, 78, 66))
    bg.paste(img, (80, 80))
    bg.rotate(2.0, expand=True, fillcolor=(90, 78, 66)).save(out / "hardware-receipt.jpg", quality=88)


def sink_photo(out: Path, name: str, leaking: bool):
    im = Image.new("RGB", (1200, 900), (205, 200, 190))
    g = ImageDraw.Draw(im)
    pipe = (150, 150, 155) if leaking else (240, 240, 240)
    g.rectangle((0, 0, 1200, 160), fill=(120, 110, 100))  # sink cabinet top
    g.rectangle((520, 160, 600, 420), fill=pipe)
    g.arc((480, 360, 760, 640), 0, 180, fill=pipe, width=80)
    g.rectangle((680, 300, 760, 500), fill=pipe)
    g.rectangle((680, 300, 1200, 380), fill=pipe)
    if leaking:
        for x, y in [(610, 640), (618, 700), (605, 760)]:
            g.ellipse((x, y, x + 22, y + 34), fill=(60, 120, 200))
        g.ellipse((480, 820, 820, 880), fill=(70, 110, 170))
        caption = "water pooling under kitchen sink"
    else:
        caption = "new white P-trap installed, cabinet floor dry"
    g.text((60, 800), caption, fill=(30, 30, 30), font=font(SANSB, 34))
    im.save(out / name, quality=85)


def screen_photo(out: Path, name: str, torn: bool):
    im = Image.new("RGB", (1200, 900), (236, 232, 222))
    g = ImageDraw.Draw(im)
    g.rectangle((150, 80, 1050, 780), fill=(250, 250, 250), outline=(120, 120, 120), width=24)
    g.rectangle((190, 120, 1010, 740), fill=(140, 170, 190))
    for x in range(190, 1010, 10):
        g.line((x, 120, x, 740), fill=(90, 100, 110), width=1)
    for y in range(120, 740, 10):
        g.line((190, y, 1010, y), fill=(90, 100, 110), width=1)
    if torn:
        g.polygon([(520, 300), (640, 260), (700, 420), (610, 560), (500, 470)], fill=(140, 170, 190))
        for dx in range(0, 160, 14):
            g.line((520 + dx, 300 - dx // 4, 560 + dx, 330), fill=(70, 70, 70), width=3)
        caption = "torn window screen, bedroom (cat scratches)"
    else:
        caption = "rescreened window, bedroom"
    g.text((60, 820), caption, fill=(30, 30, 30), font=font(SANSB, 34))
    im.save(out / name, quality=85)


ASSETS = {
    "plumbing-receipt": plumbing_receipt,
    "hardware-receipt": hardware_receipt,
    "range-hood-receipt": range_hood_receipt,
    "sink-before": lambda out: sink_photo(out, "sink-before.jpg", leaking=True),
    "sink-after": lambda out: sink_photo(out, "sink-after.jpg", leaking=False),
    "screen-before": lambda out: screen_photo(out, "screen-before.jpg", torn=True),
    "screen-after": lambda out: screen_photo(out, "screen-after.jpg", torn=False),
}


def main():
    """python scripts/demo_assets.py [out_dir] [asset ...] - all assets when none are named."""
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "demo-assets")
    names = sys.argv[2:] or list(ASSETS)
    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        ASSETS[name](out)
    print(f"Wrote {', '.join(names)} to {out}/")


if __name__ == "__main__":
    main()
