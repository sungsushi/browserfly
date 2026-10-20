# Sprite pipeline

Offline Python pipeline that renders a top-down walking fruit fly from NeuroMechFly (FlyGym) and,
in M4, turns it into the sprite sheet used by the runtime. Nothing here runs in CI; outputs are
committed under `dist/`.

## Setup

Python 3.12 (FlyGym 2.1 requires ≥ 3.12). With [uv](https://docs.astral.sh/uv/):

```bash
uv venv -p python3.12 pipeline/.venv
uv pip install -p pipeline/.venv/bin/python -r pipeline/requirements.txt
```

Pinned: `flygym==2.1.0` (Apache-2.0), `mujoco==3.9.0`, `numpy==2.5.4`, `pillow==12.3.0`,
`scipy==1.18.1`, `pytest==9.1.1`. The FlyGym wheel also installs `flygym_demo`, which contains the
recorded walking data used here.

**Headless rendering.** On macOS (Apple silicon, tested on Darwin 25) MuJoCo renders offscreen with
its default CGL backend; no `MUJOCO_GL` setting is needed. On Linux use `MUJOCO_GL=egl` (GPU) or
`MUJOCO_GL=osmesa` (CPU); not tested here.

## Phase 0 (M3): feasibility and leg readability

```bash
pipeline/.venv/bin/python pipeline/render_walk.py pipeline/out/walk_plain
pipeline/.venv/bin/python pipeline/render_walk.py pipeline/out/walk_thick --leg-thickness 1.8
pipeline/.venv/bin/python pipeline/contact_sheet.py phase0 pipeline/out/walk_plain pipeline/out/walk_thick pipeline/out
```

Outputs: `pipeline/out/phase0_contact_sheet.png`, `phase0_preview.html` (animated, self-contained)
and `phase0_stats.json`. Each render takes about 2–3 minutes on an M-series Mac.

## Sprite sheet (M4)

```bash
pipeline/.venv/bin/python pipeline/build_all.py pipeline/out/build --dist   # ~30 s
pipeline/.venv/bin/python pipeline/contact_sheet.py final dist/fly-sheet.json pipeline/out/qa
pipeline/.venv/bin/python -m pytest pipeline/tests                           # ~1.5 min (builds twice)
```

| Step | Script | What it does |
|---|---|---|
| 1 | `render_walk.py --poses-only` | Replays the 2 s recording at 0.1 ms steps; records the thorax pose, tarsus tips and leg joints (thorax frame) at every step, and the model's geometric body length. ~5 s. |
| 2 | `extract_cycle.py` | Stride period from the tarsus fore-aft signal (autocorrelation for the fundamental, refined by the windowed spectral peak; < 0.6% error in tests). Skips the 0.2 s start-up transient, keeps the steady stretch (local period within 5%), ranks straight cycles by compactness, renders the 4 frames around each candidate's seam and keeps the most compact one whose seam ratio is ≤ 1.1. Plans 16 frames evenly spaced in time (= phase within one cycle). |
| 3 | `render_walk.py --plan` | Re-runs the replay (deterministic) and renders exactly those steps, plus a 2-frame standing idle clip (neutral pose; the second frame shifts the front tibiae by 0.12 rad). |
| 4 | `align_frames.py` | Thorax centroid to a fixed point, body axis (PCA of head + thorax + abdomen, signed by the head) vertical. Measures the visible body length. |
| 5 | `build_sheet.py` | Scales the visible body length to 96 px, area-averages premultiplied colour, packs rows (walk, idle), quantises to 64 colours, writes PNG + lossless WebP + JSON. |

**Design notes**

- **Camera option B** (fixed overhead camera following the thorax, then 2D alignment), not option A
  (camera rigidly on the thorax): the thorax frame is pitched ~5° and wobbles during walking, and
  2D alignment is needed for the anchor and axis tests anyway. The camera is **orthographic**, so
  one pixel is the same distance everywhere (6.6 mm / 1600 px = 4.1 µm).
- **Labels** come from a second segmentation pass with the wings hidden (moved to geom group 1), so
  the abdomen under the wings is labelled. The head geom is attached to the thorax body, so labels
  are assigned by geom name.
- **Body length** is the *visible* length (2.59 mm), measured on the renders after an opening that
  drops slivers thinner than ~1 sprite pixel. The mesh vertices span 2.76 mm, but some abdomen-tip
  vertices are never visible from above, and the head and abdomen tips are slivers.
- **Seam:** a pose-based seam (foot tips or all leg joints) only weakly predicts how the silhouette
  loops (a cycle with a pose seam of 1.0 frames had an image seam of 1.7×), hence the image check.
- **Budget:** the frames are 143×163 for a 96 px body (legs and wings in every frame around a fixed
  anchor). At 128/96/80/64 colours the WebP is 33/30.5/28.9/26.7 KB; 64 colours is visually
  indistinguishable from 128 at 4× and leaves headroom.
- **Turn clip:** not produced (optional in the plan). The recording's turning stretches are
  irregular, and a turn clip would not fit the budget.

## FlyGym 2.1.0 findings

FlyGym 2.x replaced the 1.x API (`flygym.Fly`, `SingleFlySimulation`, the `preprogrammed` module)
with a composition API. Classes and calls used, all read from the installed source and the v2.1.0
tutorials:

| Need | How (FlyGym 2.1.0) |
|---|---|
| Body model | `flygym.compose.NeuroMechFly(mesh_type=MeshType.SIMPLIFIED_MAX2000FACES, mesh_basedir=...)`. `MeshType.FULLSIZE` meshes are downloaded lazily from EPFL's S3 bucket on first use. |
| Joints and actuators | `fly.add_joints(Skeleton(axis_order=AxisOrder.YAW_PITCH_ROLL, joint_preset=JointPreset.LEGS_ONLY), neutral_pose=KinematicPosePreset.NEUTRAL)`, then `fly.add_actuators(fly.skeleton.get_actuated_dofs_from_preset(ActuatedDOFPreset.LEGS_ACTIVE_ONLY), actuator_type=ActuatorType.POSITION, kp=150.0, neutral_input=...)` (tutorial 2). |
| Colours | `fly.colorize(visuals_yaml)`; defaults in `flygym/assets/model/neuromechfly/visuals.yaml`. We copy it and make the wings greyer and clearer (the default is lavender, alpha 0.3). |
| Leg adhesion | `fly.add_leg_adhesion()`, then `sim.set_leg_adhesion_states(fly.name, np.ones(6, bool))`. |
| World and simulation | `FlatGroundWorld().add_fly(fly, [0, 0, 0.7], Rotation3D("quat", [1, 0, 0, 0]))`, `Simulation(world, timestep=1e-4)`, `sim.reset()`, `sim.warmup()`, `sim.set_actuator_inputs(...)`, `sim.step()`. `sim.mj_model` / `sim.mj_data` expose the compiled MuJoCo model. |
| Steady forward walking | **Not in the `flygym` package.** Options in the repo: kinematic replay of recorded walking (tutorial 2, used here), or the CPG / rule-based / hybrid / turning controllers (tutorials 4a–4d, code under `flygym_demo`). |
| Recorded walking | `flygym_demo.spotlight_data.MotionSnippet()`: 2.0 s of a freely walking fly at 330 Hz from the Spotlight system, 3D pose by PoseForge, joint angles by SeqIKPy (Wang-Chen et al., 2026). `snippet.get_joint_angles(output_timestep=1e-4, output_dof_order=fly.get_actuated_jointdofs_order(ActuatorType.POSITION))` smooths, upsamples and reorders them for the actuators. |
| Custom camera | `fly.add_tracking_camera(name, mode="track", pos_offset=(0, 0, 9), rotation=Rotation3D("xyaxes", (0, -1, 0, 1, 0, 0)), fovy=40)`. The camera is a child of the thorax body. `pos_offset` is in the thorax frame. `"track"` keeps a world orientation; `"fixed"` rotates with the fly. |
| Segmentation render | Plain MuJoCo: `mujoco.Renderer(model, h, w).enable_segmentation_rendering()`; channel 0 is the object id, channel 1 the object type (`mjOBJ_GEOM`). Geoms of the world body (id 0) are the floor. |
| Thorax pose per step | `data.xpos[thorax_id]`, `data.xquat[thorax_id]` (wxyz). `sim.get_body_positions(fly.name)` / `get_body_rotations` return all segments in the skeleton's order. |

**Gotchas**

- Compiled names are namespaced by the fly name: the camera is `nmf/topcam` and the thorax body
  `nmf/c_thorax`. `mj_name2id(model, mjOBJ_CAMERA, "topcam")` returns −1, and passing −1 to
  `Renderer.update_scene` silently renders MuJoCo's default free camera. `render_walk.py` looks names
  up by suffix and fails loudly if there isn't exactly one match.
- Model units are mm (the raw STL files are in m and scaled on load). The thorax sits ~1.1 mm above
  the floor after warm-up.
- Wings are translucent. A hard segmentation mask makes them an opaque blob in the sprite.
  `render_walk.py` renders each frame twice with the floor hidden (over black, and over an emissive
  white floor) and derives exact straight alpha from the difference. Shadows and reflections are off.
- Leg meshes run along their local z axis but are not centred on it, so mesh `scale` would shift a
  thickened leg sideways. `--leg-thickness` writes thickened copies of the femur, tibia and tarsus
  STLs (radial scale about each segment's principal axis) and loads them via `mesh_basedir`.

## Measured (Phase 0, perspective camera)

From `phase0_stats.json` (2.0 s clip, steadiest 0.4 s window):

- Stepping frequency 10.8 Hz (all six legs agree within ±0.3 Hz); speed 13.6 mm/s = 5.1 BL/s.
- Body length (head to abdomen tip, wings excluded) 2.64 mm; stride 1.26 mm = **0.47 BL**.
- At 60 Hz a real-speed stride is ~5.5 display frames, so the runtime walks in slow motion
  (PLAN.md rev 4: 1.2 BL/s → 2.5 Hz stepping, ~24 display frames per stride).
- 16-frame stride sheets, 128-colour PNG, square frames centred on the thorax:
  48 px ≈ 11 KB, 96 px ≈ 33 KB, 128 px ≈ 55 KB (plain); thickened legs and outline add ~10%.
  The frames are 2.2 × BL wide because they hold the legs and the wings in every frame around a
  thorax-centred anchor; a tighter, off-centre anchor in M4 would cut this.
- Wing material alpha 0.1 per layer (each wing renders as several layers): ~0.34 overall, so the
  wings read as clear glass on light pages and pale grey on dark pages.

## Measured (M4 sheet)

From `dist/fly-sheet.json` and `pipeline/out/build/cycle.json`: stride 92.3 ms (10.8 Hz) starting
1.14 s into the recording, turning 5.5°; real speed 6.9 BL/s; strideBL 0.64 (visible body length
2.59 mm); image seam ratio 1.16 (test 2 limit 1.5); 143×163 frames, anchor [72, 67]; PNG 31.1 KB,
WebP 26.7 KB.

## Credits

NeuroMechFly and FlyGym: Wang-Chen, Stimpfling, Lam, Özdil, Genoud, Hurtak and Ramdya, EPFL
Neuroengineering Laboratory (Apache-2.0). Walking data: Spotlight / PoseForge, Wang-Chen et al.
(2026), bioRxiv 10.64898/2026.03.11.711180. Inverse kinematics: SeqIKPy, Özdil et al. (2026),
JOSS 10.21105/joss.08557.
