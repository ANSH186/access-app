#!/usr/bin/env python3
"""Validate lab_block.json (stdlib only). Exit code 1 on any failure."""
import heapq
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
START = "LB-G-ENTRANCE"
LIBRARY = "LB-2-LIBRARY"
BLOCK = "LB-2-N1__LB-2-N2"
failures = []


def check(ok, msg):
    if not ok:
        failures.append(msg)
        print("FAIL:", msg)


def build_adj(edges, step_free_only=False, skip=None):
    adj = {}
    for e in edges:
        if e["status"] == "blocked" or e["code"] == skip:
            continue
        if step_free_only and not e["step_free"]:
            continue
        # planner weights (CONTRACT 4): stairs x2, lift +20
        w = e["length_m"]
        if e["kind"] == "stairs":
            w *= 2.0
        elif e["kind"] == "lift":
            w += 20.0
        adj.setdefault(e["from_code"], []).append((e["to_code"], w, e))
        adj.setdefault(e["to_code"], []).append((e["from_code"], w, e))
    return adj


def dijkstra(adj, src):
    dist, prev, heap = {src: 0.0}, {}, [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist.get(u, float("inf")):
            continue
        for v, w, e in adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v], prev[v] = nd, (u, e)
                heapq.heappush(heap, (nd, v))
    return dist, prev


def path_len(prev, dst, src):
    raw, cur, n = 0.0, dst, 0
    while cur != src:
        cur, e = prev[cur]
        raw += e["length_m"]
        n += 1
    return raw, n


def main():
    with open(os.path.join(HERE, "lab_block.json"), encoding="utf-8") as f:
        m = json.load(f)
    nodes, edges = m["nodes"], m["edges"]
    codes = {n["code"] for n in nodes}
    check(len(codes) == len(nodes), "duplicate node codes")
    check(len({e["code"] for e in edges}) == len(edges), "duplicate edge codes")
    check(len({n["id"] for n in nodes} | {e["id"] for e in edges}) == len(nodes) + len(edges), "duplicate ids")
    for e in edges:
        check(e["from_code"] in codes and e["to_code"] in codes, f"edge {e['code']} references a missing node")
        check(e["code"] == f"{e['from_code']}__{e['to_code']}", f"edge code mismatch {e['code']}")
        check(e["length_m"] > 0, f"edge {e['code']} length <= 0")
    floor_codes = {f["code"] for f in m["floors"]}
    check(all(n["floor_code"] in floor_codes for n in nodes), "node with unknown floor")
    tokens = [n["qr_token"] for n in nodes if n["qr_token"]]
    check(len(tokens) == len(set(tokens)), "duplicate qr_tokens")
    check(len(tokens) == 6, f"expected 6 QR checkpoints, found {len(tokens)}")
    check(BLOCK in {e["code"] for e in edges}, f"edge {BLOCK} missing")
    check(START in codes, "start node missing")
    if failures:
        return finish(m)

    full = build_adj(edges)
    d_all, _ = dijkstra(full, START)
    check(len(d_all) == len(nodes), f"graph not connected: {len(nodes) - len(d_all)} nodes unreachable")

    sf = build_adj(edges, step_free_only=True)
    d_sf, prev_sf = dijkstra(sf, START)
    searchable = [n for n in nodes if n["searchable"]]
    # The courtyard is a dead-end outdoor edge (step_free=false by contract), so it is exempt step-free.
    exempt = {"LB-G-COURTYARD"}
    for n in searchable:
        check(n["code"] in d_all, f"searchable {n['code']} unreachable from entrance")
        if n["code"] not in exempt:
            check(n["code"] in d_sf, f"searchable {n['code']} unreachable step-free from entrance")

    check(LIBRARY in d_sf, "library not reachable step-free")
    base = d_sf.get(LIBRARY)
    raw_base, hops = path_len(prev_sf, LIBRARY, START) if base is not None else (0, 0)
    sf2 = build_adj(edges, step_free_only=True, skip=BLOCK)
    d2, prev2 = dijkstra(sf2, START)
    check(LIBRARY in d2, "library unreachable step-free when N1-N2 is blocked")
    raw_blocked = 0.0
    if LIBRARY in d2 and base is not None:
        raw_blocked, _ = path_len(prev2, LIBRARY, START)
        check(d2[LIBRARY] > base, "blocking N1-N2 did not lengthen the step-free path")

    print(f"nodes: {len(nodes)}  edges: {len(edges)}  QR checkpoints: {len(tokens)}  searchable: {len(searchable)}")
    print(f"step-free ENTRANCE -> LIBRARY, normal : {raw_base:.1f} m walked (planner cost {base:.1f})")
    print(f"step-free ENTRANCE -> LIBRARY, N1-N2 blocked: {raw_blocked:.1f} m walked (planner cost {d2.get(LIBRARY, float('nan')):.1f})")
    return finish(m)


def finish(m):
    if failures:
        print(f"\nVALIDATION FAILED ({len(failures)} problem(s))")
        return 1
    print("\nVALIDATION OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
