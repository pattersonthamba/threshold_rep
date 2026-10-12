# THRESHOLD

A first-person puzzle game for the browser, built around two linked gates that
conserve momentum. All code, levels, art, sound and writing are original. Textures and
audio are generated at runtime, so the whole game ships in about 139 KB gzipped.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # headless playthrough of every chamber
npm run build      # static output in dist/
```

## Deploy to Vercel

The repo is a static Vite site. `vercel.json` sets the build command, sets the
output directory to `dist`, and makes hashed assets cacheable forever.

```bash
npx vercel        # or import the repo in the Vercel dashboard
```

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move |
| Space | Jump |
| Left / right mouse (or Q) | Fire teal / magenta gate |
| E (or F) | Lift / drop a mass core |
| R | Restart chamber |
| Esc | Pause |

Settings (sensitivity, FOV, gate-view quality, volume, invert Y, FPS counter) and
chamber progress are saved in `localStorage`. Open `/attract` to see the menu scene
without the UI.

## Chambers

1. **Calibration**: place two gates and step through.
2. **Counterweight**: carry a mass core through a gate to a button.
3. **Static Veil**: a veil erases gates and dissolves cores, so route around it.
4. **Momentum**: fall into a floor gate and fly out of a wall gate.
5. **Updraft**: turn a launch plate's vertical throw into horizontal distance.
6. **Convergence**: make the fling while carrying a core.
7. **Twin Keys**: a door that needs two plates, with one core sealed in a glass alcove. Move a gate from inside to get out.
8. **Delivery**: drop a core through a floor gate so it falls onto plates on an island you can't reach.
9. **Periscope**: shots pass through gates. Fire through one to place a gate in a room you can only see through the other.
10. **Sluice**: get a core around a veil, then deliver it across a hazard pool.
11. **Terminal Velocity**: build up a floor-to-ceiling fall loop, then move one gate mid-plunge and fly out at 40 m/s.
12. **Keystone**: periscope into a sealed room, fetch the core, and carry it back out.

### Expert chambers

13. **Mail Slot**: the plate sits at the end of a 1 m-high duct only a core fits into. Launch the core across the pool on its own; if you follow it, you're stranded.
14. **Freefall Courier**: two plates on opposite sides of a 25 m pool. Carry a core through a terminal-velocity fall loop, then put the second core on a launch plate so it flies back and slides into a slot on the start side.
15. **Blind Courier**: periscope into a sealed room with no low panels, escape with the core through its floor, then get round a full-height veil by gating from one side of it to the other.
16. **Event Horizon**: two cores and one shared drop zone. Launch one into a slot, then move a single gate to drop the other onto an island.

See [docs/BREAKDOWN.md](docs/BREAKDOWN.md) for the reverse-engineering notes and the
engine design.
