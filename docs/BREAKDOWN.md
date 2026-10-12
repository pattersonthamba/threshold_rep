# Reverse-engineering breakdown and redesign notes

## 1. What `portal2.exe` actually is

Static analysis with REA (Ghidra 12.1.4 provider plus REA's PE resource parser) of
`C:\Program Files (x86)\Steam\steamapps\common\Portal 2\portal2.exe`.

| Fact | Value | Evidence |
| --- | --- | --- |
| SHA-256 | `18b57b16…a8c8` | `open_binary` |
| Format | PE32, x86 (machine 0x14c) | `ev_87f3…eddff` |
| File size | 358,912 bytes | `ev_87f3…eddff` |
| `.text` (code) | 34,816 bytes | `ev_0886…f8ac` |
| `.rsrc` (resources) | 305,664 bytes (~85% of the file) | `ev_0886…f8ac` |
| Procedures / strings | 309 / 164 | `ev_0886…f8ac` |
| Resources | 11 `RT_ICON` images + 1 `RT_GROUP_ICON` (16–256 px), nothing else | `ev_87f3…eddff` |

**Observed.** The strings that matter are `%s\bin\launcher.dll`, `PATH=%s\bin\;%s`,
`LauncherMain`, `Failed to load the launcher DLL`, `Failed calling GetModuleFileName`,
and the imports `GetModuleFileNameA`, `SetEnvironmentVariableA`, `LoadLibraryExA`,
`GetProcAddress` (`ev_612e…e538e`). The other strings are standard MSVC CRT runtime
messages.

**Inferred (from strings and imports, not traced instruction by instruction).** The
executable is a thin launcher stub:

1. Resolve its own directory with `GetModuleFileName`.
2. Prepend `<game>\bin\` to `PATH` so that the engine DLLs resolve.
3. `LoadLibraryEx("bin\launcher.dll")`, then `GetProcAddress("LauncherMain")`.
4. Pass control to `LauncherMain`. If any step fails, show a "Launcher Error" message box.

So the game is not in this file. It lives in roughly 50 modules under `bin\` (from the
directory listing): `engine.dll` (4.8 MB), `materialsystem.dll`, `shaderapidx9.dll` /
`shaderapivk.dll`, `studiorender.dll`, `vphysics.dll`, `vscript.dll`,
`soundsystem.dll`, `vgui2.dll`, `inputsystem.dll`, plus Steam, Bink video, Miles audio
and CEF (Chromium) for UI. Game rules (`server.dll` / `client.dll`) sit under
`portal2\bin\`. Content is shipped as packed VPK archives, compiled BSP maps and
precompiled shaders.

**Deliberately not done.** I did not decompile or lift code from the engine DLLs, and
I did not extract any content (maps, models, textures, audio, voice, text). Everything
in THRESHOLD is written from scratch. Only the general gameplay idea is shared: two
linked openings that conserve momentum. The name, characters, chambers, dialogue, art
and sound are all original.

## 2. Why the original is heavy, and what the browser version does instead

| Native stack (inferred from the module list) | THRESHOLD (browser) |
| --- | --- |
| BSP maps with precomputed visibility and lightmaps | 1 m voxel grid per chamber. A face-culled, merged mesh with baked vertex AO gives ~3 draw calls per chamber |
| Full rigid-body physics module (`vphysics.dll`) | Axis-separated AABB sweeps against the grid at a fixed 120 Hz step. A collision query is a handful of array lookups |
| Shipped textures in VPK archives | Every texture is generated on a canvas at startup, so there are 0 image downloads |
| Shipped audio (Miles, Bink, voice files) | Every sound is synthesised with WebAudio, so there are 0 audio downloads |
| Recursive portal rendering in the engine | One off-screen render per *visible* portal, sampled in screen space. The render-target resolution is adjustable (50/75/100%). Recursion is capped at one level |
| CEF/VGUI menus | Plain DOM and CSS |

Delivered size: about 139 KB gzipped in total (about 15 KB of game code, with three.js
in its own long-cached chunk).

## 3. Runtime architecture

```
main.js   input, UI, fixed-step loop, audio and effect wiring
  ├─ sim.js     pure simulation (no DOM, no WebGL): player, gates, mass cores,
  │             buttons, doors, veils, hazard pools, launch plates
  │   └─ world.js   voxel grid, AABB sweeps, DDA raycast, mesh building
  ├─ view.js    three.js scene: chamber meshes, gate rendering, effects
  ├─ audio.js   synthesised SFX and ambience
  └─ levels.js  chamber builders (data, not maps)
```

### Gate maths
Each gate stores an orthonormal basis `B = [right, up, normal] + position`. The
transform from gate *P* to its partner *Q* is

```
M = B_Q · RotY(180°) · B_P⁻¹
```

Positions are mapped with `M` and velocities with its rotation part, so speed is
conserved and its direction is re-expressed in the exit gate's frame. When a body
crosses a gate plane inside the opening, it is teleported and then pushed out by its
half-extent along the exit normal. While a body is lined up with an opening, the
wall cells behind that gate are ignored for collision. A small capture assist centres
fast-falling bodies so that long drops still land in a 1×2 m opening.

### Gate rendering
For each visible gate, the camera is moved through `M` and the scene is rendered
into that gate's render target. A clip plane on the exit wall stops geometry behind it
from leaking into the view. The gate surface shader samples the render target with
`gl_FragCoord / resolution`, so perspective is correct with no oblique-projection
maths. While a gate's view is being rendered, both gate surfaces use a flat material,
so no texture is ever read while it is being written.

## 4. Verification

`npm test` runs `scripts/sim-test.mjs`. It drives the headless simulation through
every chamber with scripted input (aim, fire, walk, carry, step off ledges) and
checks that each one can be completed:

```
PASS chamber 1..6: complete
```
