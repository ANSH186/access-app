# NIE North Campus map

AccessAble includes an outdoor graph for **NIE North Campus** (Koorgalli / Hootagalli,
Mysuru — the campus with CSE, CSE AI & ML and MCA).

## What is included

| File | Purpose |
|---|---|
| `services/api/app/data/nie_north_campus.json` | The graph the API serves. 19 destinations and 14 path junctions (33 nodes, 36 edges). |
| `apps/mobile/src/data/nieNorthCampus.json` | The same graph bundled in the phone app, so navigation works offline. |
| `services/api/app/static/campus/nie_north_campus.png` | Dark schematic map for sighted helpers. |
| `data/campus/nie_north_campus.json` | Source copy for documentation. |
| `supabase/seed_north_campus.sql` | Optional SQL to add the same graph to the database for the admin dashboard. |
| `data/campus/build_north_campus.py` | Generator for all of the above. |

## How the graph was made

- The campus outline and building positions were traced from an Esri World
  Imagery satellite view centred on `12.3720, 76.5850`. The satellite image is
  not redistributed; only our own schematic drawing is included.
- Photon / OpenStreetMap identifies the site as “The National Institute Of
  Engineering North Campus (NIE North)” and gives an extent of roughly
  `76.5839–76.5907 E, 12.3698–12.3749 N`.
- The NIE website lists the North Campus at No. 50 (Part), Koorgalli village,
  Hootagalli Industrial Area, Mysuru 570018.
- Building labels are a **reasonable schematic assignment** from the layout:
  A/B/C academic blocks, Central Library, Administrative Office, canteen,
  hostels, sports ground, gym, health centre, washrooms and the main gate.

## Why a graph, not a trained model

Navigation is deterministic: the app computes a shortest path over a verified
graph and speaks landmark-based instructions. Training an image model to invent
routes would be unsafe and unrepeatable. The “campus knowledge” that the AI
assistant uses is the **grounded destination list** from this graph; the AI never
decides the route.

## Verification status

> **The map is a schematic and has not been verified on site.** All campus nodes
> and edges are marked `verified: false`. The app and API say this aloud / in the
> UI. Before using it for a real student:

1. Walk the campus with a staff member or a sighted volunteer.
2. Open the admin dashboard as `mapeditor@accessable.demo`, or run
   `supabase/seed_north_campus.sql` and edit the rows.
3. Correct building names, entrances, paths, stairs/ramps, and add QR
   checkpoints at the main gate, library, canteen, A Block, hostel and sports
   ground.
4. Mark nodes/edges `verified = true` only after checking them.
5. Re-run `python data/campus/build_north_campus.py` after changing the
   generator, or edit the JSON directly for small fixes.

## QR checkpoints

The bundled map defines these tokens:

- `AA-NC-GATE` — Main Gate and Security
- `AA-NC-A` — A Block (CSE)
- `AA-NC-LIB` — Central Library
- `AA-NC-CANTEEN` — Canteen and Mess
- `AA-NC-HOSTEL-B` — Boys Hostel
- `AA-NC-SPORTS` — Sports Ground

The scanner resolves unknown tokens against the bundled map, so these work even
before they are inserted into the database.

## Rebuilding

```powershell
python data/campus/build_north_campus.py
```

This writes the JSON copies, SQL seed and schematic PNG.
