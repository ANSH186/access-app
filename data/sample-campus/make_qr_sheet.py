"""Print-ready A4 PDF of the QR checkpoints in lab_block.json.

    pip install "qrcode[pil]" reportlab
    python3 make_qr_sheet.py            # writes qr_checkpoints.pdf next to this file

Each code is 8 cm wide: bigger codes are easier to find when you can't see well.
Stick them at the same height everywhere (about 1.2 m) so people learn where to point the phone.
"""
import io
import json
from pathlib import Path

import qrcode
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
FRIENDLY = {  # token suffix -> place description
    "ENTRANCE": "Main entrance",
    "LIFT": "Near the lift",
    "SESTAIR": "South-east staircase",
    "LIBRARY": "Outside the Department Library",
}


def place_name(token: str) -> str:
    for suffix, name in FRIENDLY.items():
        if token.endswith(suffix):
            return name
    return token


def main():
    data = json.loads((HERE / "lab_block.json").read_text())
    floors = {f["code"]: f["name"] for f in data["floors"]}
    cps = [n for n in data["nodes"] if n.get("qr_token")]
    level = {f["code"]: f["level"] for f in data["floors"]}
    cps.sort(key=lambda n: (level[n["floor_code"]], n["qr_token"]))

    out = HERE / "qr_checkpoints.pdf"
    c = canvas.Canvas(str(out), pagesize=A4)
    W, H = A4
    size = 8 * cm
    cols, rows = 2, 2
    cell_w, cell_h = W / cols, (H - 3 * cm) / rows

    for i, n in enumerate(cps):
        if i and i % (cols * rows) == 0:
            c.showPage()
        if i % (cols * rows) == 0:
            c.setFont("Helvetica-Bold", 14)
            c.drawCentredString(W / 2, H - 1.4 * cm, "AccessAble checkpoints — Lab Block (TEST / pilot)")
            c.setFont("Helvetica", 9)
            c.drawCentredString(W / 2, H - 2.0 * cm,
                                "Placeholder positions: confirm each spot on site before sticking. Cut along the boxes.")
        k = i % (cols * rows)
        col, row = k % cols, k // cols
        x0 = col * cell_w
        y0 = H - 2.6 * cm - (row + 1) * cell_h

        img = qrcode.make(n["qr_token"], box_size=10, border=2,
                          error_correction=qrcode.constants.ERROR_CORRECT_H)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        c.drawImage(ImageReader(buf), x0 + (cell_w - size) / 2, y0 + (cell_h - size) / 2 + 0.6 * cm, size, size)

        c.setFont("Helvetica-Bold", 13)
        c.drawCentredString(x0 + cell_w / 2, y0 + 1.5 * cm,
                            f"{floors[n['floor_code']]} — {place_name(n['qr_token'])}")
        c.setFont("Courier", 9)
        c.drawCentredString(x0 + cell_w / 2, y0 + 0.9 * cm, n["qr_token"])
        c.setDash(3, 3)
        c.rect(x0 + 0.5 * cm, y0 + 0.4 * cm, cell_w - 1 * cm, cell_h - 0.6 * cm)
        c.setDash()

    c.save()
    print(f"wrote {out} with {len(cps)} checkpoints")


if __name__ == "__main__":
    main()
