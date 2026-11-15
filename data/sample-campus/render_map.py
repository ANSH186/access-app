#!/usr/bin/env python3
"""Render lab_block.json to lab_block_floors.svg (stdlib only), for human checking against the photo."""
import json
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
PW, PH = 470, 500          # panel size
X0, X1, Y0, Y1 = -17, 44, -10, 54
SC = 7.7                   # px per metre
TITLE = "Lab Block — PLACEHOLDER layout (from one courtyard photo, verify on site)"
COL = {"corridor": "#555", "door": "#999", "stairs": "#c0392b", "lift": "#1f6feb", "outdoor": "#2e8b57"}


def main():
    with open(os.path.join(HERE, "lab_block.json"), encoding="utf-8") as f:
        m = json.load(f)
    nodes = {n["code"]: n for n in m["nodes"]}
    W, H = PW * 2 + 30, 60 + PH * 2 + 20 + 70
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Arial, sans-serif">',
         f'<rect width="{W}" height="{H}" fill="#fff"/>',
         f'<text x="{W/2}" y="30" text-anchor="middle" font-size="20" font-weight="bold">{escape(TITLE)}</text>']

    def P(ox, oy, x, y):
        return ox + (x - X0) * SC, oy + (Y1 - y) * SC

    for i, fl in enumerate(m["floors"]):
        ox, oy = 10 + (i % 2) * (PW + 10), 50 + (i // 2) * (PH + 10)
        o.append(f'<rect x="{ox}" y="{oy}" width="{PW}" height="{PH}" fill="#fafafa" stroke="#bbb"/>')
        o.append(f'<text x="{ox+10}" y="{oy+22}" font-size="16" font-weight="bold">{escape(fl["name"])}</text>')
        cx0, cy0 = P(ox, oy, 0, 45)
        cx1, cy1 = P(ox, oy, 30, 0)
        o.append(f'<rect x="{cx0}" y="{cy0}" width="{cx1-cx0}" height="{cy1-cy0}" fill="#dff0d8" stroke="none"/>')
        tx, ty = P(ox, oy, 15, 30)
        o.append(f'<text x="{tx}" y="{ty}" text-anchor="middle" font-size="12" fill="#6a9a5a">courtyard lawn</text>')
        ns = [n for n in m["nodes"] if n["floor_code"] == fl["code"]]
        codes = {n["code"] for n in ns}
        for e in m["edges"]:
            if e["from_code"] in codes and e["to_code"] in codes:
                a, b = nodes[e["from_code"]], nodes[e["to_code"]]
                (x1, y1), (x2, y2) = P(ox, oy, a["x"], a["y"]), P(ox, oy, b["x"], b["y"])
                w, dash = (3, "") if e["kind"] == "corridor" else (1.5, ' stroke-dasharray="4 3"' if e["kind"] == "outdoor" else "")
                o.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{COL[e["kind"]]}" stroke-width="{w}"{dash}/>')
        for n in ns:
            x, y = P(ox, oy, n["x"], n["y"])
            k, name = n["kind"], n["code"].split("-", 2)[2]
            lab = None
            if k == "corridor":
                o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="#555"/>')
            elif k == "stairs":
                o.append(f'<polygon points="{x:.1f},{y-7:.1f} {x-7:.1f},{y+6:.1f} {x+7:.1f},{y+6:.1f}" fill="#c0392b"/>')
                lab = "N stairs" if name == "NSTAIR" else "SE stairs"
            elif k == "lift":
                o.append(f'<rect x="{x-6:.1f}" y="{y-6:.1f}" width="12" height="12" fill="#1f6feb"/>')
                lab = "Lift (assumed)"
            else:
                col = {"entrance": "#8e44ad", "emergency_point": "#2e8b57"}.get(k, "#222")
                o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{col}"/>')
                lab = n["label"].replace("Main entrance (assumed position)", "Entrance (assumed)").replace("Ground floor washroom", "Washroom").replace("Floor %s washroom" % fl["code"][-1], "Washroom")
            if n["qr_token"]:
                o.append(f'<polygon points="{x:.1f},{y-11:.1f} {x+11:.1f},{y:.1f} {x:.1f},{y+11:.1f} {x-11:.1f},{y:.1f}" fill="none" stroke="#e67e00" stroke-width="2.5"/>')
            if lab:
                anchor, dx = ("end", -9) if n["x"] < 15 and k != "emergency_point" else ("start", 9)
                if k == "emergency_point":
                    anchor, dx = "middle", 0
                dy = 4 if k != "emergency_point" else 16
                if name == "HELPDESK":
                    anchor, dx, dy = "end", -9, 4
                elif name == "ENTRANCE":
                    anchor, dx, dy = "start", 15, 4
                o.append(f'<text x="{x+dx:.1f}" y="{y+dy:.1f}" text-anchor="{anchor}" font-size="10">{escape(lab)}</text>')
    ly = 50 + PH * 2 + 25
    o.append(f'<text x="14" y="{ly}" font-size="13" font-weight="bold">Legend</text>')
    items = [("line", "#555", "corridor (ring)"), ("tri", "#c0392b", "staircase"), ("sq", "#1f6feb", "lift (assumed)"),
             ("dia", "#e67e00", "QR checkpoint"), ("dot", "#222", "room / lab / office"),
             ("dot", "#8e44ad", "entrance (assumed)"), ("dot", "#2e8b57", "assembly point"), ("dash", "#2e8b57", "outdoor dead end")]
    for j, (s, c, t) in enumerate(items):
        x, y = 14 + (j % 4) * 230, ly + 22 + (j // 4) * 24
        if s == "line":
            o.append(f'<line x1="{x}" y1="{y-4}" x2="{x+22}" y2="{y-4}" stroke="{c}" stroke-width="3"/>')
        elif s == "dash":
            o.append(f'<line x1="{x}" y1="{y-4}" x2="{x+22}" y2="{y-4}" stroke="{c}" stroke-width="1.5" stroke-dasharray="4 3"/>')
        elif s == "tri":
            o.append(f'<polygon points="{x+11},{y-12} {x+4},{y+1} {x+18},{y+1}" fill="{c}"/>')
        elif s == "sq":
            o.append(f'<rect x="{x+5}" y="{y-10}" width="12" height="12" fill="{c}"/>')
        elif s == "dia":
            o.append(f'<polygon points="{x+11},{y-14} {x+22},{y-4} {x+11},{y+6} {x},{y-4}" fill="none" stroke="{c}" stroke-width="2.5"/>')
        else:
            o.append(f'<circle cx="{x+11}" cy="{y-4}" r="4.5" fill="{c}"/>')
        o.append(f'<text x="{x+30}" y="{y}" font-size="12">{escape(t)}</text>')
    o.append(f'<text x="14" y="{H-8}" font-size="11" fill="#666">North is up; x runs west to east 0-30 m, y south to north 0-45 m. Room names are invented. Stairs/lift positions repeat on every floor.</text>')
    o.append("</svg>")
    out = os.path.join(HERE, "lab_block_floors.svg")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(o))
    print("wrote", out)


if __name__ == "__main__":
    main()
