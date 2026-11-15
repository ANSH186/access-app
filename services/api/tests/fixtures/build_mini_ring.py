"""Generates mini_ring_map.json: 2 floors, ring corridor + lift + north stair, library on floor 1.
Follows CONTRACT section 3 geometry. Run: python build_mini_ring.py"""
import json, math, pathlib

RING = [("SW",0,0),("S1",10,0),("SM",15,0),("S2",20,0),("SE",30,0),("E0",30,6),("E1",30,11),("E2",30,22),
        ("E3",30,34),("NE",30,45),("N2",20,45),("N1",10,45),("NW",0,45),("W3",0,34),("W2",0,22),("W1",0,11)]
FLOORS = [("LB-G",0,"Ground floor"),("LB-1",1,"Floor 1")]
nodes, edges = [], []
def node(code, fc, kind, label, x, y, aliases=(), searchable=False, qr=None, verified=False, notes=None):
    nodes.append(dict(code=code, floor_code=fc, kind=kind, label=label, aliases=list(aliases), x=x, y=y,
                      searchable=searchable, qr_token=qr, verified=verified, notes=notes))
def edge(a, b, kind, length=None, step_free=True):
    na = next(n for n in nodes if n["code"] == a); nb = next(n for n in nodes if n["code"] == b)
    L = length if length is not None else math.hypot(na["x"]-nb["x"], na["y"]-nb["y"])
    edges.append(dict(code=f"{a}__{b}", from_code=a, to_code=b, kind=kind, length_m=L, step_free=step_free,
                      status="open", verified=False))
for fc, lvl, fname in FLOORS:
    L = fc.split("-")[1]
    for name, x, y in RING:
        node(f"LB-{L}-{name}", fc, "corridor", f"{fname} corridor {name}", x, y)
    for i in range(len(RING)):
        edge(f"LB-{L}-{RING[i][0]}", f"LB-{L}-{RING[(i+1)%len(RING)][0]}", "corridor")
    node(f"LB-{L}-NSTAIR", fc, "stairs", "North staircase", 10, 48, notes="Position not confirmed")
    edge(f"LB-{L}-N1", f"LB-{L}-NSTAIR", "door", 3, False)
    node(f"LB-{L}-LIFT", fc, "lift", "Lift", -3, 45, notes="Position not confirmed — check on site")
    edge(f"LB-{L}-NW", f"LB-{L}-LIFT", "door", 3, True)
node("LB-G-ENTRANCE","LB-G","entrance","Main entrance (assumed position)",15,-4,["entrance","main entrance"],True,"AA-CP-G-ENTRANCE")
edge("LB-G-ENTRANCE","LB-G-SM","door",4,True)
node("LB-G-WASHROOM","LB-G","washroom","Ground floor washroom",33,45,["washroom","toilet","restroom","bathroom","ground floor washroom"],True)
edge("LB-G-NE","LB-G-WASHROOM","door",3,True)
node("LB-1-LIBRARY","LB-1","library","Department Library",20,48,["library","reading room","department library"],True)
edge("LB-1-N2","LB-1-LIBRARY","door",3,True)
node("LB-1-LAB101","LB-1","lab","Lab 101",-3,11,["lab 101","101"],True)
edge("LB-1-W1","LB-1-LAB101","door",3,True)
node("LB-1-LAB102","LB-1","lab","Lab 102",-3,22,["lab 102","102"],True)
edge("LB-1-W2","LB-1-LAB102","door",3,True)
for n in nodes:
    if n["code"]=="LB-1-N2": n["qr_token"]="AA-CP-1-LIBRARY"
    if n["code"]=="LB-1-NW": n["qr_token"]="AA-CP-1-LIFT"
for a, b in (("G","1"),):
    edge(f"LB-{a}-NSTAIR", f"LB-{b}-NSTAIR", "stairs", 12, False)
    edge(f"LB-{a}-LIFT", f"LB-{b}-LIFT", "lift", 4, True)
out = dict(institution_id="00000000-0000-0000-0000-000000000001",
           building=dict(code="LB", name="Lab Block (mini test map)"),
           floors=[dict(id=None, code=c, level=l, name=n) for c,l,n in FLOORS], nodes=nodes, edges=edges)
for f in out["floors"]: del f["id"]
pathlib.Path(__file__).with_name("mini_ring_map.json").write_text(json.dumps(out, indent=1))
