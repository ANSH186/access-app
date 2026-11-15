# Sample campus: Lab Block (placeholder map)

A placeholder indoor map for the AccessAble AI pilot. Everything here is `verified = false`.

## What the photo shows
`lab-block-reference.jpg` is one night photo from the courtyard of the lab building: a ground floor plus three upper
floors around a rectangular lawn. Open corridors with railings on the courtyard side run around the courtyard on every
floor, and rooms open off the outer side. A staircase is visible in the back (north) wing, left of centre, and another
at the front-right (south-east) of the east wing.

## Coordinates
Metres, building frame. x runs 0 (west) to 30 (east); y runs 0 (south, the photo side) to 45 (north, back wing).
The courtyard centre is (15, 22.5). Every floor uses the same x/y; floors differ only by `floor_code`. Rooms sit 3 m outside
their corridor node. Edge lengths are straight-line distances rounded to 0.1 m (stairs 12 m, lift 4 m between floors).

## Seen vs assumed
| Seen in the photo | Assumed / invented |
|---|---|
| Courtyard ring of corridors on all floors | Exact dimensions (30 m x 45 m) and node spacing |
| North staircase, south-east staircase | Stair positions repeat identically on every floor |
| Railings on the courtyard side | **Lift** position (-3, 45): no lift is visible; marked unverified |
| Rooms along the outer side | **Main entrance** (15, -4) is assumed |
| | All room names/numbers, washroom positions, help desk, library on Floor 2 |
| | QR checkpoint positions |

## Regenerate
```
python3 build_map.py      # writes lab_block.json and ../../supabase/seed.sql
python3 validate_map.py   # connectivity, step-free reachability, blocked-edge demo, QR checks
python3 render_map.py     # writes lab_block_floors.svg to compare against the photo
```
Standard library only.

## Correcting it on site
- [ ] Measure the real corridor lengths (and stair/lift lengths) and update node coordinates in `RING` / `build_map.py`.
- [ ] Find out whether there is a lift. If yes, confirm where; if no, remove the lift nodes and the lift QR checkpoints.
- [ ] Confirm the main entrance position (and whether it is step-free).
- [ ] Replace invented names with the real room numbers and names; fix aliases.
- [ ] Confirm which stairs exist on which floors and whether they have handrails.
- [ ] Decide where to stick each QR code (waist-height, beside a door or the lift call button, with a tactile or large-print label):
  `AA-CP-G-ENTRANCE`, `AA-CP-G-LIFT`, `AA-CP-1-SESTAIR`, `AA-CP-2-LIFT`, `AA-CP-2-LIBRARY`, `AA-CP-3-LIFT`.
- [ ] Mark nodes/edges `verified = true` in the admin dashboard as each is checked; set building `lat`/`lng`.
