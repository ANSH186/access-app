"""Build the NIE North Campus map (schematic) used by the API and mobile app.

The campus buildings and paths were traced from an Esri World Imagery satellite
view of NIE North Campus (Koorgalli / Hootagalli, Mysuru). They are a *schematic*
and must be verified on site before being treated as authoritative. The graph is
deliberately simple: deterministic routing, no ML.

Run from the repository root:
    python data/campus/build_north_campus.py
"""
from __future__ import annotations

import json
import math
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
NAMESPACE = uuid.UUID("6f1c2a1e-7d1b-4c5e-9a43-2b8f0d7e4a10")
INSTITUTION_ID = "00000000-0000-0000-0000-000000000001"

# Local metric frame: x east, y north, metres.
LAT0, LNG0 = 12.3700, 76.5830
M_PER_DEG_LAT = 110_540.0
M_PER_DEG_LNG = 111_320.0 * math.cos(math.radians(LAT0))

FLOOR = {"id": str(uuid.uuid5(NAMESPACE, "NIE-NC-G")), "code": "NIE-NC-G", "level": 0, "name": "NIE North Campus"}
BUILDING = {
    "id": str(uuid.uuid5(NAMESPACE, "NIE-NC")),
    "code": "NIE-NC",
    "name": "NIE North Campus",
    "lat": 12.3720,
    "lng": 76.5850,
    "is_placeholder": True,
    "notes": "Schematic traced from satellite imagery. Verify building names and paths on site.",
}

# code, label, kind, lat, lng, searchable, aliases, qr, notes
NODE_SPECS = [
    # Path / junction nodes (not searchable)
    ("NC-P1", "Campus entrance plaza", "corridor", 12.37140, 76.58420, False, [], None, None),
    ("NC-P2", "Campus road junction", "corridor", 12.37155, 76.58460, False, [], None, None),
    ("NC-P3", "Academic quad south", "corridor", 12.37185, 76.58495, False, [], None, None),
    ("NC-P4", "Academic quad north", "corridor", 12.37210, 76.58530, False, [], None, None),
    ("NC-P5", "Library path junction", "corridor", 12.37190, 76.58575, False, [], None, None),
    ("NC-P6", "Canteen path junction", "corridor", 12.37145, 76.58605, False, [], None, None),
    ("NC-P7", "Hostel path junction", "corridor", 12.37105, 76.58615, False, [], None, None),
    ("NC-P8", "Sports path south", "corridor", 12.37235, 76.58610, False, [], None, None),
    ("NC-P9", "Sports path north", "corridor", 12.37285, 76.58630, False, [], None, None),
    ("NC-P10", "Gym path", "corridor", 12.37265, 76.58495, False, [], None, None),
    ("NC-P11", "Health centre path", "corridor", 12.37180, 76.58455, False, [], None, None),
    ("NC-P12", "Admin path", "corridor", 12.37140, 76.58475, False, [], None, None),
    ("NC-P13", "Parking and drop-off", "corridor", 12.37160, 76.58450, False, [], None, None),
    ("NC-P14", "Assembly path", "corridor", 12.37245, 76.58670, False, [], None, None),
    # Destinations
    ("NC-GATE", "Main Gate and Security", "entrance", 12.37120, 76.58380, True,
     ["main gate", "gate", "security", "entrance", "front gate", "campus gate"], "AA-NC-GATE",
     "Satellite view shows the campus access off the highway. Verify the exact gate."),
    ("NC-BUS", "Bus Stop", "entrance", 12.37100, 76.58355, True,
     ["bus stop", "bus", "bmtc", "ksrtc", "transport"], None, None),
    ("NC-ADMIN", "Administrative Office", "office", 12.37130, 76.58475, True,
     ["admin", "administration", "office", "principal office", "accounts", "admissions"], None, None),
    ("NC-A", "A Block (CSE)", "lab", 12.37200, 76.58485, True,
     ["a block", "block a", "cse", "computer science", "computer science and engineering", "cs"], "AA-NC-A",
     "Building label is a reasonable assignment from the campus layout; verify on site."),
    ("NC-B", "B Block (CSE AI and ML)", "lab", 12.37180, 76.58525, True,
     ["b block", "block b", "ai ml", "aiml", "artificial intelligence", "machine learning", "cse ai"], None,
     "Building label is a reasonable assignment from the campus layout; verify on site."),
    ("NC-C", "C Block (MCA)", "lab", 12.37215, 76.58560, True,
     ["c block", "block c", "mca", "master of computer applications", "pg block"], None,
     "Building label is a reasonable assignment from the campus layout; verify on site."),
    ("NC-LIB", "Central Library", "library", 12.37185, 76.58585, True,
     ["library", "central library", "reading room", "books", "study room"], "AA-NC-LIB",
     "Library position is approximate. Verify on site."),
    ("NC-AUD", "Auditorium", "room", 12.37140, 76.58555, True,
     ["auditorium", "hall", "seminar hall", "events", "convention"], None, None),
    ("NC-CANTEEN", "Canteen and Mess", "room", 12.37120, 76.58610, True,
     ["canteen", "mess", "food court", "food", "cafeteria", "dining", "eat"], "AA-NC-CANTEEN", None),
    ("NC-HOSTEL-B", "Boys Hostel", "room", 12.37080, 76.58625, True,
     ["boys hostel", "boy hostel", "male hostel", "hostel b", "hostel"], "AA-NC-HOSTEL-B", None),
    ("NC-HOSTEL-G", "Girls Hostel", "room", 12.37095, 76.58695, True,
     ["girls hostel", "girl hostel", "female hostel", "hostel g", "hostel"], None, None),
    ("NC-SPORTS", "Sports Ground", "emergency_point", 12.37290, 76.58610, True,
     ["sports ground", "ground", "playground", "cricket", "football", "athletics", "track", "field"], "AA-NC-SPORTS", None),
    ("NC-GYM", "Indoor Sports and Gym", "room", 12.37270, 76.58480, True,
     ["gym", "indoor sports", "indoor games", "badminton", "basketball", "fitness"], None, None),
    ("NC-HEALTH", "Health Centre and First Aid", "help_desk", 12.37178, 76.58445, True,
     ["health centre", "health center", "first aid", "medical", "clinic", "doctor", "nurse", "sick room"], None, None),
    ("NC-WASH-ACAD", "Academic Block Washroom", "washroom", 12.37205, 76.58515, True,
     ["washroom", "toilet", "restroom", "bathroom", "academic washroom"], None, None),
    ("NC-WASH-HOSTEL", "Hostel Washroom", "washroom", 12.37090, 76.58655, True,
     ["hostel washroom", "hostel toilet", "toilet", "washroom"], None, None),
    ("NC-HELPDESK", "Help Desk and Reception", "help_desk", 12.37150, 76.58455, True,
     ["help desk", "helpdesk", "reception", "front desk", "information", "inquiry"], None, None),
    ("NC-ASSEMBLY", "Emergency Assembly Point", "emergency_point", 12.37250, 76.58675, True,
     ["assembly point", "assembly area", "emergency point", "muster point", "safe area"], None, None),
    ("NC-LAB", "Innovation and Project Lab", "lab", 12.37170, 76.58600, True,
     ["innovation lab", "project lab", "makerspace", "incubation", "lab"], None, None),
]

# code, from, to, kind
EDGE_SPECS = [
    ("NC-GATE", "NC-P1", "outdoor"),
    ("NC-BUS", "NC-GATE", "outdoor"),
    ("NC-P1", "NC-P13", "outdoor"),
    ("NC-P1", "NC-P2", "outdoor"),
    ("NC-P13", "NC-P2", "outdoor"),
    ("NC-P2", "NC-P12", "outdoor"),
    ("NC-P12", "NC-ADMIN", "outdoor"),
    ("NC-P12", "NC-HELPDESK", "outdoor"),
    ("NC-P2", "NC-P11", "outdoor"),
    ("NC-P11", "NC-HEALTH", "outdoor"),
    ("NC-P2", "NC-P3", "outdoor"),
    ("NC-P3", "NC-A", "outdoor"),
    ("NC-P3", "NC-B", "outdoor"),
    ("NC-P3", "NC-P4", "outdoor"),
    ("NC-P4", "NC-C", "outdoor"),
    ("NC-P4", "NC-WASH-ACAD", "outdoor"),
    ("NC-P4", "NC-P5", "outdoor"),
    ("NC-P5", "NC-LIB", "outdoor"),
    ("NC-P5", "NC-LAB", "outdoor"),
    ("NC-P5", "NC-P6", "outdoor"),
    ("NC-P6", "NC-CANTEEN", "outdoor"),
    ("NC-P6", "NC-AUD", "outdoor"),
    ("NC-P6", "NC-P7", "outdoor"),
    ("NC-P7", "NC-HOSTEL-B", "outdoor"),
    ("NC-P7", "NC-WASH-HOSTEL", "outdoor"),
    ("NC-P6", "NC-P8", "outdoor"),
    ("NC-P8", "NC-P9", "outdoor"),
    ("NC-P9", "NC-SPORTS", "outdoor"),
    ("NC-P9", "NC-ASSEMBLY", "outdoor"),
    ("NC-P8", "NC-P14", "outdoor"),
    ("NC-P14", "NC-ASSEMBLY", "outdoor"),
    ("NC-P14", "NC-HOSTEL-G", "outdoor"),
    ("NC-P8", "NC-P10", "outdoor"),
    ("NC-P10", "NC-GYM", "outdoor"),
    ("NC-P10", "NC-P4", "outdoor"),
    ("NC-P1", "NC-P3", "outdoor"),
]


def xy(lat: float, lng: float) -> tuple[float, float]:
    return ((lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT)


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def build() -> dict:
    by_code = {}
    nodes = []
    for code, label, kind, lat, lng, searchable, aliases, qr, notes in NODE_SPECS:
        x, y = xy(lat, lng)
        node = {
            "id": str(uuid.uuid5(NAMESPACE, code)),
            "code": code,
            "floor_code": FLOOR["code"],
            "kind": kind,
            "label": label,
            "aliases": aliases,
            "x": round(x, 2),
            "y": round(y, 2),
            "lat": lat,
            "lng": lng,
            "searchable": searchable,
            "qr_token": qr,
            "verified": False,
            "notes": notes or ("Schematic from satellite view. Verify on site." if searchable else None),
        }
        by_code[code] = node
        nodes.append(node)

    edges = []
    seen = set()
    for from_code, to_code, kind in EDGE_SPECS:
        key = tuple(sorted((from_code, to_code)))
        if key in seen:
            raise SystemExit(f"duplicate edge: {key}")
        seen.add(key)
        a, b = by_code[from_code], by_code[to_code]
        length = max(1.0, round(dist((a["x"], a["y"]), (b["x"], b["y"])), 1))
        code = f"{from_code}__{to_code}"
        edges.append({
            "id": str(uuid.uuid5(NAMESPACE, code)),
            "code": code,
            "from_code": from_code,
            "to_code": to_code,
            "kind": kind,
            "length_m": length,
            "step_free": True,
            "status": "open",
            "verified": False,
        })

    return {
        "institution_id": INSTITUTION_ID,
        "building": BUILDING,
        "floors": [FLOOR],
        "nodes": nodes,
        "edges": edges,
        "notes": (
            "NIE North Campus schematic. Traced from satellite imagery; building names and "
            "path positions must be verified on site before being treated as authoritative."
        ),
        "map_image": "/static/campus/nie_north_campus.png",
        "campus_center": {"lat": 12.3720, "lng": 76.5850},
    }


def _font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf") if bold else Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") if bold else Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def render_schematic(data: dict, out: Path, dark: bool = True) -> None:
    W, H = 1600, 1200
    bg = (10, 10, 10) if dark else (250, 248, 242)
    fg = (255, 255, 255) if dark else (20, 20, 20)
    muted = (190, 190, 190) if dark else (70, 70, 70)
    accent = (255, 214, 10)
    path_col = (120, 120, 128) if dark else (120, 120, 120)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)

    nodes = {n["code"]: n for n in data["nodes"]}
    xs = [n["x"] for n in data["nodes"]]
    ys = [n["y"] for n in data["nodes"]]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    pad = 80
    sx = (W - 2 * pad) / max(1, maxx - minx)
    sy = (H - 2 * pad - 90) / max(1, maxy - miny)
    scale = min(sx, sy)

    def p(n):
        return (pad + (n["x"] - minx) * scale, H - pad - 40 - (n["y"] - miny) * scale)

    # paths
    for e in data["edges"]:
        a, b = nodes[e["from_code"]], nodes[e["to_code"]]
        d.line([p(a), p(b)], fill=path_col, width=8)
    # destinations
    for n in data["nodes"]:
        if not n["searchable"]:
            continue
        x, y = p(n)
        r = 16
        d.ellipse([x - r, y - r, x + r, y + r], fill=accent, outline=fg, width=2)
        label = n["label"]
        tw = d.textlength(label, font=_font(22, True))
        lx = x + 22
        if lx + tw > W - 20:
            lx = x - 22 - tw
        d.text((lx, y - 13), label, fill=fg, font=_font(22, True))
        d.text((x - 6, y - 10), "●", fill=(0, 0, 0), font=_font(18, True))

    d.text((pad, 24), "NIE North Campus — AccessAble schematic map", fill=fg, font=_font(34, True))
    d.text((pad, 66), "Approximate layout traced from satellite imagery. Verify names and paths on site.", fill=muted, font=_font(19))
    d.text((pad, H - 46), "Yellow dots are destinations. Grey lines are walkable paths. North is up.", fill=muted, font=_font(18))
    img.save(out, optimize=True)


def sql_quote(s: str | None) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def write_sql(data: dict, out: Path) -> None:
    b = data["building"]
    lines = [
        "-- GENERATED by data/campus/build_north_campus.py. Safe to run repeatedly.",
        "-- NIE North Campus schematic. Verify names and paths on site.",
        "BEGIN;",
        (
            "INSERT INTO public.buildings (id, institution_id, code, name, lat, lng, is_placeholder, notes) VALUES "
            f"({sql_quote(b['id'])}, {sql_quote(INSTITUTION_ID)}, {sql_quote(b['code'])}, {sql_quote(b['name'])}, "
            f"{b['lat']}, {b['lng']}, true, {sql_quote(b['notes'])}) "
            "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, "
            "is_placeholder = EXCLUDED.is_placeholder, notes = EXCLUDED.notes;"
        ),
    ]
    for f in data["floors"]:
        lines.append(
            "INSERT INTO public.floors (id, building_id, code, level, name) VALUES "
            f"({sql_quote(f['id'])}, {sql_quote(b['id'])}, {sql_quote(f['code'])}, {f['level']}, {sql_quote(f['name'])}) "
            "ON CONFLICT (id) DO UPDATE SET building_id = EXCLUDED.building_id, code = EXCLUDED.code, "
            "level = EXCLUDED.level, name = EXCLUDED.name;"
        )
    lines.append(
        "INSERT INTO public.route_nodes (id, floor_id, code, kind, label, aliases, x, y, searchable, qr_token, verified, notes) VALUES"
    )
    rows = []
    for n in data["nodes"]:
        aliases = "ARRAY[" + ", ".join(sql_quote(a) for a in n["aliases"]) + "]::text[]"
        rows.append(
            f"  ({sql_quote(n['id'])}, {sql_quote(data['floors'][0]['id'])}, {sql_quote(n['code'])}, "
            f"{sql_quote(n['kind'])}, {sql_quote(n['label'])}, {aliases}, {n['x']}, {n['y']}, "
            f"{'true' if n['searchable'] else 'false'}, {sql_quote(n['qr_token'])}, false, {sql_quote(n['notes'])})"
        )
    lines.append(",\n".join(rows))
    lines.append(
        "ON CONFLICT (id) DO UPDATE SET floor_id = EXCLUDED.floor_id, code = EXCLUDED.code, kind = EXCLUDED.kind, "
        "label = EXCLUDED.label, aliases = EXCLUDED.aliases, x = EXCLUDED.x, y = EXCLUDED.y, "
        "searchable = EXCLUDED.searchable, qr_token = EXCLUDED.qr_token, notes = EXCLUDED.notes;"
    )
    lines.append(
        "INSERT INTO public.route_edges (id, code, from_node_id, to_node_id, kind, length_m, step_free, status, verified) VALUES"
    )
    node_id = {n["code"]: n["id"] for n in data["nodes"]}
    erows = []
    for e in data["edges"]:
        erows.append(
            f"  ({sql_quote(e['id'])}, {sql_quote(e['code'])}, {sql_quote(node_id[e['from_code']])}, "
            f"{sql_quote(node_id[e['to_code']])}, {sql_quote(e['kind'])}, {e['length_m']}, true, 'open', false)"
        )
    lines.append(",\n".join(erows))
    lines.append(
        "ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, from_node_id = EXCLUDED.from_node_id, "
        "to_node_id = EXCLUDED.to_node_id, kind = EXCLUDED.kind, length_m = EXCLUDED.length_m, "
        "step_free = EXCLUDED.step_free;"
    )
    lines.append("COMMIT;")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", out)


def main() -> None:
    data = build()
    json_text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    outputs = [
        ROOT / "data" / "campus" / "nie_north_campus.json",
        ROOT / "services" / "api" / "app" / "data" / "nie_north_campus.json",
        ROOT / "apps" / "mobile" / "src" / "data" / "nieNorthCampus.json",
    ]
    for path in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json_text, encoding="utf-8")
        print("wrote", path)

    write_sql(data, ROOT / "supabase" / "seed_north_campus.sql")

    static_dir = ROOT / "services" / "api" / "app" / "static" / "campus"
    static_dir.mkdir(parents=True, exist_ok=True)
    render_schematic(data, static_dir / "nie_north_campus.png")
    for p in (ROOT / "data" / "campus" / "nie_north_campus.png",):
        p.write_bytes((static_dir / "nie_north_campus.png").read_bytes())
    print("wrote map images")


if __name__ == "__main__":
    main()
