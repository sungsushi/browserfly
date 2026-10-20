"""Replay recorded walking in NeuroMechFly (FlyGym 2.1) and render it from directly overhead.

The camera is orthographic, follows the thorax position and keeps a world orientation (world +x,
the fly's initial heading, at the top of the image), so one pixel is the same distance everywhere.
Frames are aligned head-up later (align_frames.py).

Modes:
  default        render every --every physics steps:   rgba_XXXX.png, label_XXXX.png, poses.npy
  --poses-only   no images; record the thorax pose, the six tarsus tips and the leg joints (in the
                 thorax frame) every --every steps:       sim.npz
  --plan FILE    render exactly the steps listed in FILE (from extract_cycle.py) as the walk clip,
                 plus the standing idle clip:             walk_XX.png, walk_XX_label.png,
                                                          idle_XX.png, idle_XX_label.png, frames.json
All modes write render.json (settings, versions, mm per pixel).

RGBA is straight alpha. Alpha comes from rendering each frame twice with the floor hidden, over
black and over white, so translucent wings and antialiased edges get correct partial alpha. Label
maps hold the part under each pixel: see LABELS.

Usage: python pipeline/render_walk.py OUT [--poses-only | --plan cycle.json] [--res 1600]
                                          [--view-mm 6.6] [--every N] [--leg-thickness 1.0]
"""
import argparse
import json
import struct
import tempfile
from pathlib import Path

import flygym
import mujoco as mj
import numpy as np
import yaml
from PIL import Image

from flygym import Simulation
from flygym.anatomy import ActuatedDOFPreset, AxisOrder, JointPreset, Skeleton
from flygym.compose import ActuatorType, FlatGroundWorld, KinematicPosePreset, MeshType, NeuroMechFly
from flygym.utils.math import Rotation3D
from flygym_demo.spotlight_data import MotionSnippet

LEGS = ("lf", "lm", "lh", "rf", "rm", "rh")
LEG_PREFIXES = tuple(f"{leg}_" for leg in LEGS)
LEG_JOINT_SEGMENTS = ("trochanterfemur", "tibia", "tarsus1", "tarsus5")
# Thickened legs: the long, thin segments. Coxae are already stout.
THIN_LEG_PARTS = ("trochanterfemur", "tibia", "tarsus")
SIM_DT = 1e-4
CAMERA_HEIGHT = 9.0  # mm above the thorax; irrelevant to scale for an orthographic camera
WARMUP_S = 0.05
IDLE_SETTLE_S = 0.3
IDLE_STEP_S = 0.15
IDLE_TIBIA_DELTA = 0.12  # rad: front tibiae shift slightly between the two idle frames
# Wing material RGBA: grey-blue, so the wings show on white pages (variant C of the wing-colour
# prototypes; was 0.86 0.86 0.88 / 0.1). Each wing renders as several overlapping layers, so
# per-layer alpha compounds (0.12 → ~0.4 overall).
WING_RGBA = (0.60, 0.66, 0.78, 0.12)

# Part labels in label maps (by geom name; the head geom hangs off the thorax body). Labels come
# from a segmentation pass with the wings hidden, so the abdomen under the wings is labelled; "wing"
# marks pixels where only wing is present. "other": antennae and halteres.
LABELS = {"background": 0, "thorax": 1, "head": 2, "abdomen": 3, "other": 4, "leg": 5, "wing": 6}
HEAD_PARTS = ("c_head", "eye", "rostrum", "haustellum")
WING_GROUP = 1  # unused by FlyGym (it uses 0 and 2); drawn by default, hidden in one segmentation pass


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--poses-only", action="store_true", help="simulate and record poses, no images")
    mode.add_argument("--plan", type=Path, help="cycle.json from extract_cycle.py: render those steps")
    ap.add_argument("--res", type=int, default=1600, help="square render resolution (px)")
    ap.add_argument("--view-mm", type=float, default=6.6, help="orthographic view height (mm)")
    ap.add_argument("--every", type=int, default=None,
                    help="physics steps (0.1 ms) between frames; default 30 (images) or 1 (poses)")
    ap.add_argument("--leg-thickness", type=float, default=1.0, help="radial scale of the thin leg segments")
    ap.add_argument("--mesh", choices=["simplified", "fullsize"], default="simplified")
    ap.add_argument("--wing-rgba", type=float, nargs=4, default=WING_RGBA, metavar=("R", "G", "B", "A"),
                    help="wing material colour, 0–1 (alpha is per layer)")
    args = ap.parse_args()
    if args.every is None:
        args.every = 1 if args.poses_only else 30
    return args


# --- STL helpers (binary and ASCII), used to write thickened leg meshes -------------------------

def read_stl(path):
    b = Path(path).read_bytes()
    if b[:5] == b"solid" and b"facet" in b[:512]:
        verts = [list(map(float, ln.split()[1:4])) for ln in b.decode().splitlines() if ln.strip().startswith("vertex")]
        return np.array(verts, np.float32).reshape(-1, 3, 3)
    n = struct.unpack("<I", b[80:84])[0]
    rec = np.frombuffer(b[84:84 + 50 * n], dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]))
    return rec["v"].reshape(-1, 3, 3).copy()


def write_stl(path, tris):
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-20)
    rec = np.zeros(len(tris), dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]))
    rec["n"] = normals
    rec["v"] = tris.reshape(-1, 9)
    Path(path).write_bytes(b"\0" * 80 + struct.pack("<I", len(tris)) + rec.tobytes())


def thicken(tris, k):
    """Scales each vertex's distance from the segment's principal axis by k (length unchanged)."""
    v = tris.reshape(-1, 3).astype(np.float64)
    m = v.mean(0)
    axis = np.linalg.eigh(np.cov((v - m).T))[1][:, -1]
    t = (v - m) @ axis
    radial = v - m - np.outer(t, axis)
    return (m + np.outer(t, axis) + k * radial).astype(np.float32).reshape(tris.shape)


def mesh_dir(mesh_type, leg_thickness):
    src = Path(flygym.assets_dir) / "model/neuromechfly/meshes" / mesh_type.value
    if leg_thickness == 1.0:
        return None  # use FlyGym's default directory
    if mesh_type is MeshType.FULLSIZE:
        raise SystemExit("--leg-thickness is only supported with the simplified meshes")
    tmp = Path(tempfile.mkdtemp(prefix="nmf_meshes_")) / mesh_type.value
    tmp.mkdir()
    for f in src.iterdir():
        data = f.read_bytes()
        if f.suffix == ".stl" and f.stem.startswith(LEG_PREFIXES) and any(p in f.stem for p in THIN_LEG_PARTS):
            write_stl(tmp / f.name, thicken(read_stl(f), leg_thickness))
        else:
            (tmp / f.name).write_bytes(data)
    return tmp.parent


# --- model ----------------------------------------------------------------------------------------

def visuals_config(out_dir, wing_rgba=WING_RGBA):
    """FlyGym's default visuals with our wing colour (FlyGym's default is lavender)."""
    cfg = yaml.safe_load((Path(flygym.assets_dir) / "model/neuromechfly/visuals.yaml").read_text())
    cfg["wing"]["material"]["rgba"] = [float(v) for v in wing_rgba]
    path = out_dir / "visuals.yaml"
    path.write_text(yaml.safe_dump(cfg))
    return path


def build(args):
    neutral = KinematicPosePreset.NEUTRAL
    act = ActuatorType.POSITION
    mesh_type = MeshType.FULLSIZE if args.mesh == "fullsize" else MeshType.SIMPLIFIED_MAX2000FACES
    kwargs = {"mesh_type": mesh_type}
    md = mesh_dir(mesh_type, args.leg_thickness)
    if md is not None:
        kwargs["mesh_basedir"] = md
    fly = NeuroMechFly(**kwargs)
    # As in FlyGym tutorial 2: legs actuated by position actuators tracking recorded angles.
    fly.add_joints(Skeleton(axis_order=AxisOrder.YAW_PITCH_ROLL, joint_preset=JointPreset.LEGS_ONLY),
                   neutral_pose=neutral)
    fly.add_actuators(fly.skeleton.get_actuated_dofs_from_preset(ActuatedDOFPreset.LEGS_ACTIVE_ONLY),
                      actuator_type=act, kp=150.0, neutral_input=neutral)
    fly.colorize(visuals_config(args.out, getattr(args, "wing_rgba", WING_RGBA)))
    fly.add_leg_adhesion()
    # For an orthographic camera, fovy is the view height in model units (mm).
    fly.add_tracking_camera(name="topcam", mode="track", pos_offset=(0, 0, CAMERA_HEIGHT),
                            rotation=Rotation3D("xyaxes", (0, -1, 0, 1, 0, 0)), fovy=args.view_mm,
                            proj=mj.mjtProjection.mjPROJ_ORTHOGRAPHIC)
    world = FlatGroundWorld()
    world.add_fly(fly, [0, 0, 0.7], Rotation3D(format="quat", values=[1, 0, 0, 0]))
    return fly, act, Simulation(world, timestep=SIM_DT)


def by_suffix(model, objtype, count, suffix):
    """Compiled names are namespaced by the fly (e.g. "nmf/topcam"): match on the suffix."""
    hits = [i for i in range(count) if (mj.mj_id2name(model, objtype, i) or "").endswith(suffix)]
    if len(hits) != 1:
        raise RuntimeError(f"expected one {objtype} ending in {suffix!r}, found {len(hits)}")
    return hits[0]


def geom_labels(model):
    """Label per geom id; the extra last entry is for background pixels (id −1)."""
    labels = np.zeros(model.ngeom + 1, np.uint8)
    for g in range(model.ngeom):
        if model.geom_bodyid[g] == 0:
            continue  # world body: floor
        name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM, g).split("/")[-1]
        if name.startswith(LEG_PREFIXES):
            labels[g] = LABELS["leg"]
        elif "wing" in name:
            labels[g] = LABELS["wing"]
        elif name == "c_thorax":
            labels[g] = LABELS["thorax"]
        elif name.startswith("c_abdomen"):
            labels[g] = LABELS["abdomen"]
        elif any(p in name for p in HEAD_PARTS):
            labels[g] = LABELS["head"]
        else:
            labels[g] = LABELS["other"]
    return labels


class OverheadRenderer:
    """Renders straight-alpha RGBA via a black and a white background, plus part labels."""

    def __init__(self, model, res, cam_id):
        self.model, self.cam_id = model, cam_id
        self.rgb = mj.Renderer(model, res, res)
        self.seg = mj.Renderer(model, res, res)
        self.seg.enable_segmentation_rendering()
        self.labels = geom_labels(model)
        wings = self.labels[:-1] == LABELS["wing"]
        model.geom_group[wings] = WING_GROUP
        self.no_wings = mj.MjvOption()
        mj.mjv_defaultOption(self.no_wings)
        self.no_wings.geomgroup[WING_GROUP] = 0
        self.floor = [g for g in range(model.ngeom) if model.geom_bodyid[g] == 0]
        model.light_castshadow[:] = 0  # flat overhead lighting, no shadows
        self.floor_rgba = model.geom_rgba[self.floor].copy()
        self.floor_mat = model.geom_matid[self.floor].copy()

    def _pass(self, data, background):
        m = self.model
        m.geom_matid[self.floor] = -1
        # Black: invisible floor and no skybox. White: a plain floor lit to saturation.
        m.geom_rgba[self.floor] = (0, 0, 0, 0) if background == "black" else (1, 1, 1, 1)
        self.rgb.update_scene(data, camera=self.cam_id)
        self.rgb.scene.flags[mj.mjtRndFlag.mjRND_SKYBOX] = 0
        self.rgb.scene.flags[mj.mjtRndFlag.mjRND_REFLECTION] = 0
        img = self.rgb.render().astype(np.float32) / 255
        m.geom_rgba[self.floor] = self.floor_rgba
        m.geom_matid[self.floor] = self.floor_mat
        return img

    def _labels(self, data, option):
        self.seg.update_scene(data, camera=self.cam_id, scene_option=option)
        seg = self.seg.render()
        ids = np.where(seg[..., 1] == int(mj.mjtObj.mjOBJ_GEOM), seg[..., 0], -1)
        return self.labels[ids]

    def render(self, data):
        black = self._pass(data, "black")
        white = self._pass(data, "white")
        # Over a background b, a pixel is c·α + b·(1 − α): black gives c·α, white − black gives 1 − α
        # (normalised by the floor's own brightness in case it is not exactly 1).
        floor_white = np.median(white[:8, :8].reshape(-1, 3), axis=0)
        alpha = np.clip(1 - ((white - black) / np.maximum(floor_white, 1e-3)).mean(-1), 0, 1)
        top = self._labels(data, None)
        label = self._labels(data, self.no_wings)
        label[(label == 0) & (top == LABELS["wing"])] = LABELS["wing"]
        rgb = np.where(alpha[..., None] > 1e-3, black / np.maximum(alpha[..., None], 1e-3), 0)
        rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
        return (rgba * 255).round().astype(np.uint8), label, floor_white


# --- runs -----------------------------------------------------------------------------------------

class Run:
    def __init__(self, args):
        self.args = args
        self.fly, self.act, self.sim = build(args)
        self.model, self.data = self.sim.mj_model, self.sim.mj_data
        m = self.model
        self.cam = by_suffix(m, mj.mjtObj.mjOBJ_CAMERA, m.ncam, "topcam")
        self.thorax = by_suffix(m, mj.mjtObj.mjOBJ_BODY, m.nbody, "/c_thorax")
        self.tarsi = [by_suffix(m, mj.mjtObj.mjOBJ_BODY, m.nbody, f"/{leg}_tarsus5") for leg in LEGS]
        # Joint positions along each leg (body origins), for comparing whole-leg poses.
        self.leg_joints = [by_suffix(m, mj.mjtObj.mjOBJ_BODY, m.nbody, f"/{leg}_{seg}")
                           for leg in LEGS for seg in LEG_JOINT_SEGMENTS]
        self.snippet = MotionSnippet()
        self.targets = self.snippet.get_joint_angles(
            output_timestep=SIM_DT, output_dof_order=self.fly.get_actuated_jointdofs_order(self.act))

    def start(self):
        self.sim.reset()
        self.sim.set_leg_adhesion_states(self.fly.name, np.ones(6, dtype=bool))
        self.sim.warmup(WARMUP_S)

    def thorax_pose(self):
        return np.concatenate([self.data.xpos[self.thorax], self.data.xquat[self.thorax]])

    def in_thorax_frame(self, bodies):
        R = self.data.xmat[self.thorax].reshape(3, 3)
        return (self.data.xpos[bodies] - self.data.xpos[self.thorax]) @ R

    def replay(self, last_step, on_step):
        """Steps the recorded targets 0..last_step and calls on_step(i) after each step."""
        self.start()
        for i in range(last_step + 1):
            self.sim.set_actuator_inputs(self.fly.name, self.act, self.targets[i])
            self.sim.step()
            on_step(i)

    def neutral_targets(self):
        all_dofs = [str(d) for d in self.fly.get_jointdofs_order()]
        angles = self.sim.get_joint_angles(self.fly.name)
        return np.array([angles[all_dofs.index(str(d))] for d in self.fly.get_actuated_jointdofs_order(self.act)])

    def body_length_mm(self):
        """Head tip to abdomen tip along the thorax's horizontal heading, from the mesh vertices of
        the head, thorax and abdomen geoms (antennae, wings and legs excluded)."""
        m, d = self.model, self.data
        heading = d.xmat[self.thorax].reshape(3, 3)[:, 0].copy()
        heading[2] = 0
        heading /= np.linalg.norm(heading)
        proj = []
        for g in range(m.ngeom):
            name = (mj.mj_id2name(m, mj.mjtObj.mjOBJ_GEOM, g) or "").split("/")[-1]
            if name in ("c_head", "c_thorax") or name.startswith("c_abdomen"):
                mesh = m.geom_dataid[g]
                v = m.mesh_vert[m.mesh_vertadr[mesh]: m.mesh_vertadr[mesh] + m.mesh_vertnum[mesh]]
                world = d.geom_xpos[g] + v @ d.geom_xmat[g].reshape(3, 3).T
                proj.append(world @ heading)
        proj = np.concatenate(proj)
        return float(proj.max() - proj.min())

    def front_tibia_indices(self):
        return [i for i, d in enumerate(self.fly.get_actuated_jointdofs_order(self.act))
                if d.child.name in ("lf_tibia", "rf_tibia") and d.axis.value == "pitch"]


def save_frame(out, name, rgba, label):
    Image.fromarray(rgba, "RGBA").save(out / f"{name}.png")
    Image.fromarray(label).save(out / f"{name}_label.png")


def run_poses(run, args):
    run.start()
    body_length = run.body_length_mm()  # in the settled neutral pose
    rows, tarsi, joints = [], [], []

    def record(i):
        if i % args.every == 0:
            rows.append(np.concatenate([[i, (i + 1) * SIM_DT], run.thorax_pose()]))
            tarsi.append(run.in_thorax_frame(run.tarsi))
            joints.append(run.in_thorax_frame(run.leg_joints))

    run.replay(run.targets.shape[0] - 1, record)
    rows = np.array(rows)
    np.savez(args.out / "sim.npz", step=rows[:, 0].astype(np.int64), t=rows[:, 1], thorax_pos=rows[:, 2:5],
             thorax_quat=rows[:, 5:9], tarsi=np.array(tarsi), leg_joints=np.array(joints, np.float32),
             legs=np.array(LEGS))
    return {"records": len(rows), "bodyLengthMm": body_length}


def run_frames(run, renderer, args):
    poses = []

    def maybe_render(i):
        if i % args.every:
            return
        rgba, label, _ = renderer.render(run.data)
        k = len(poses)
        Image.fromarray(rgba, "RGBA").save(args.out / f"rgba_{k:04d}.png")
        Image.fromarray(label).save(args.out / f"label_{k:04d}.png")
        poses.append(np.concatenate([[(i + 1) * SIM_DT], run.thorax_pose()]))

    run.replay(run.targets.shape[0] - 1, maybe_render)
    np.save(args.out / "poses.npy", np.array(poses))
    return {"frames": len(poses)}


def run_plan(run, renderer, args):
    plan = json.loads(args.plan.read_text())
    steps = [int(s) for s in plan["walkSteps"]]
    wanted = {s: k for k, s in enumerate(steps)}
    frames = {"walk": [], "idle": []}

    def maybe_render(i):
        if i in wanted:
            k = wanted[i]
            rgba, label, _ = renderer.render(run.data)
            save_frame(args.out, f"walk_{k:02d}", rgba, label)
            frames["walk"].append({"step": i, "thorax": run.thorax_pose().tolist()})

    run.replay(max(steps), maybe_render)

    # Idle: the neutral standing pose, then the same with the front tibiae shifted a little.
    run.start()
    neutral = run.neutral_targets()
    for k, delta in enumerate((0.0, IDLE_TIBIA_DELTA)):
        targets = neutral.copy()
        targets[run.front_tibia_indices()] += delta
        n = int(round((IDLE_SETTLE_S if k == 0 else IDLE_STEP_S) / SIM_DT))
        for _ in range(n):
            run.sim.set_actuator_inputs(run.fly.name, run.act, targets)
            run.sim.step()
        rgba, label, _ = renderer.render(run.data)
        save_frame(args.out, f"idle_{k:02d}", rgba, label)
        frames["idle"].append({"thorax": run.thorax_pose().tolist()})
    (args.out / "frames.json").write_text(json.dumps(frames, indent=1))
    return {"walkFrames": len(frames["walk"]), "idleFrames": len(frames["idle"])}


def main():
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    run = Run(args)
    if args.poses_only:
        result = run_poses(run, args)
    else:
        renderer = OverheadRenderer(run.model, args.res, run.cam)
        result = run_plan(run, renderer, args) if args.plan else run_frames(run, renderer, args)
    meta = {
        "flygym": "2.1.0", "mujoco": mj.__version__,
        "source": "flygym_demo.spotlight_data.MotionSnippet (Spotlight recording, kinematic replay)",
        "dataFps": run.snippet.data_fps, "simDt": SIM_DT, "warmupS": WARMUP_S, "every": args.every,
        "res": args.res, "viewMm": args.view_mm, "mmPerPx": args.view_mm / args.res,
        "camera": "orthographic, tracks thorax position, world orientation (world +x up)",
        "mesh": args.mesh, "legThickness": args.leg_thickness, "wingRgba": list(args.wing_rgba),
        "labels": LABELS, **result,
    }
    (args.out / "render.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
