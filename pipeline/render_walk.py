"""Replay recorded walking in NeuroMechFly (FlyGym 2.1) and render it from directly overhead.

Writes into OUT/:
  rgba_XXXX.png   straight-alpha RGBA. Alpha comes from rendering each frame twice, over black
                  and over white with the floor hidden, so translucent wings and antialiased
                  edges get correct partial alpha.
  label_XXXX.png  per-pixel part labels from the segmentation render: 0 background, 1 body
                  (head, thorax, abdomen, eyes, antennae, halteres), 2 legs, 3 wings.
  poses.npy       per frame: [time, thorax x, y, z, thorax quat w, x, y, z]
  render.json     settings, versions and camera geometry.

Usage: python pipeline/render_walk.py OUT [--res 1536] [--fovy 40] [--every 30]
                                          [--leg-thickness 1.0] [--mesh simplified|fullsize]
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

HERE = Path(__file__).resolve().parent
LEG_PREFIXES = ("lf_", "lm_", "lh_", "rf_", "rm_", "rh_")
# Thickened legs: the long, thin segments. Coxae are already stout.
THIN_LEG_PARTS = ("trochanterfemur", "tibia", "tarsus")
SIM_DT = 1e-4
CAMERA_HEIGHT = 9.0  # mm above the thorax
LABEL_BODY, LABEL_LEG, LABEL_WING = 1, 2, 3


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    ap.add_argument("--res", type=int, default=1536, help="square render resolution (px)")
    ap.add_argument("--fovy", type=float, default=40.0, help="vertical field of view (deg)")
    ap.add_argument("--every", type=int, default=30, help="physics steps (0.1 ms) between frames")
    ap.add_argument("--start", type=float, default=0.0, help="first rendered time (s, after warm-up)")
    ap.add_argument("--duration", type=float, default=None, help="rendered duration (s); default: whole clip")
    ap.add_argument("--leg-thickness", type=float, default=1.0, help="radial scale of the thin leg segments")
    ap.add_argument("--mesh", choices=["simplified", "fullsize"], default="simplified")
    return ap.parse_args()


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

def visuals_config(out_dir):
    """FlyGym's default visuals with clearer, greyer wings (the default is lavender)."""
    cfg = yaml.safe_load((Path(flygym.assets_dir) / "model/neuromechfly/visuals.yaml").read_text())
    # Each wing renders as several overlapping layers, so per-layer alpha compounds (0.1 → ~0.34).
    cfg["wing"]["material"]["rgba"] = [0.86, 0.86, 0.88, 0.1]
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
    fly.colorize(visuals_config(args.out))
    fly.add_leg_adhesion()
    # Follows the thorax position with a fixed world orientation, looking straight down with
    # world +x (the fly's initial heading) at the top of the image.
    fly.add_tracking_camera(name="topcam", mode="track", pos_offset=(0, 0, CAMERA_HEIGHT),
                            rotation=Rotation3D("xyaxes", (0, -1, 0, 1, 0, 0)), fovy=args.fovy)
    world = FlatGroundWorld()
    world.add_fly(fly, [0, 0, 0.7], Rotation3D(format="quat", values=[1, 0, 0, 0]))
    return fly, act, Simulation(world, timestep=SIM_DT)


def by_suffix(model, objtype, count, suffix):
    """Compiled names are namespaced by the fly (e.g. "nmf/topcam"): match on the suffix."""
    hits = [i for i in range(count) if mj.mj_id2name(model, objtype, i).endswith(suffix)]
    if len(hits) != 1:
        raise RuntimeError(f"expected one {objtype} ending in {suffix!r}, found {len(hits)}")
    return hits[0]


def geom_labels(model):
    labels = np.zeros(model.ngeom + 1, np.uint8)  # last entry: background (id −1)
    for g in range(model.ngeom):
        if model.geom_bodyid[g] == 0:
            continue  # world body: floor
        name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY, model.geom_bodyid[g]).split("/")[-1]
        labels[g] = LABEL_WING if "wing" in name else LABEL_LEG if name.startswith(LEG_PREFIXES) else LABEL_BODY
    return labels


class OverheadRenderer:
    """Renders straight-alpha RGBA via a black and a white background, plus part labels."""

    def __init__(self, model, res, cam_id):
        self.model, self.cam_id = model, cam_id
        self.rgb = mj.Renderer(model, res, res)
        self.seg = mj.Renderer(model, res, res)
        self.seg.enable_segmentation_rendering()
        self.labels = geom_labels(model)
        self.floor = [g for g in range(model.ngeom) if model.geom_bodyid[g] == 0]
        model.light_castshadow[:] = 0  # flat overhead lighting, no shadows
        self.floor_rgba = model.geom_rgba[self.floor].copy()
        self.floor_mat = model.geom_matid[self.floor].copy()

    def _pass(self, data, background):
        m = self.model
        m.geom_matid[self.floor] = -1
        if background == "black":
            m.geom_rgba[self.floor] = (0, 0, 0, 0)  # invisible floor; skybox off → black
        else:
            m.geom_rgba[self.floor] = (1, 1, 1, 1)
        self.rgb.update_scene(data, camera=self.cam_id)
        self.rgb.scene.flags[mj.mjtRndFlag.mjRND_SKYBOX] = 0
        self.rgb.scene.flags[mj.mjtRndFlag.mjRND_REFLECTION] = 0
        img = self.rgb.render().astype(np.float32) / 255
        m.geom_rgba[self.floor] = self.floor_rgba
        m.geom_matid[self.floor] = self.floor_mat
        return img

    def render(self, data):
        black = self._pass(data, "black")
        white = self._pass(data, "white")
        # Over a background b, a pixel is c·α + b·(1 − α): black gives c·α, white − black gives 1 − α.
        # The lit white floor is not exactly 1, so normalise by its own (per-channel) brightness.
        floor_white = np.median(white[:8, :8].reshape(-1, 3), axis=0)
        alpha = 1 - ((white - black) / np.maximum(floor_white, 1e-3)).mean(-1)
        alpha = np.clip(alpha, 0, 1)
        self.seg.update_scene(data, camera=self.cam_id)
        seg = self.seg.render()
        ids = np.where(seg[..., 1] == int(mj.mjtObj.mjOBJ_GEOM), seg[..., 0], -1)
        label = self.labels[ids]
        rgb = np.where(alpha[..., None] > 1e-3, black / np.maximum(alpha[..., None], 1e-3), 0)
        rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
        return (rgba * 255).round().astype(np.uint8), label, floor_white


def main():
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    fly, act, sim = build(args)
    model, data = sim.mj_model, sim.mj_data
    cam_id = by_suffix(model, mj.mjtObj.mjOBJ_CAMERA, model.ncam, "topcam")
    thorax = by_suffix(model, mj.mjtObj.mjOBJ_BODY, model.nbody, "/c_thorax")
    renderer = OverheadRenderer(model, args.res, cam_id)

    snippet = MotionSnippet()
    targets = snippet.get_joint_angles(output_timestep=SIM_DT,
                                       output_dof_order=fly.get_actuated_jointdofs_order(act))
    first = int(round(args.start / SIM_DT))
    last = targets.shape[0] if args.duration is None else min(targets.shape[0], first + int(round(args.duration / SIM_DT)))

    sim.reset()
    sim.set_leg_adhesion_states(fly.name, np.ones(6, dtype=bool))
    sim.warmup()
    t0 = sim.time
    poses, floor_whites = [], []
    for i in range(last):
        sim.set_actuator_inputs(fly.name, act, targets[i])
        sim.step()
        if i < first or (i - first) % args.every:
            continue
        k = len(poses)
        rgba, label, fw = renderer.render(data)
        Image.fromarray(rgba, "RGBA").save(args.out / f"rgba_{k:04d}.png")
        Image.fromarray(label).save(args.out / f"label_{k:04d}.png")
        poses.append(np.concatenate([[sim.time - t0], data.xpos[thorax], data.xquat[thorax]]))
        floor_whites.append(fw)
    np.save(args.out / "poses.npy", np.array(poses))

    view_mm = 2 * CAMERA_HEIGHT * np.tan(np.radians(args.fovy / 2))  # at thorax height
    meta = {
        "flygym": flygym.__dict__.get("__version__", "2.1.0"), "mujoco": mj.__version__,
        "source": "flygym_demo.spotlight_data.MotionSnippet (Spotlight recording, kinematic replay)",
        "dataFps": snippet.data_fps, "simDt": SIM_DT, "renderEverySteps": args.every,
        "renderFps": 1 / (SIM_DT * args.every), "frames": len(poses), "res": args.res, "fovy": args.fovy,
        "cameraHeightMm": CAMERA_HEIGHT, "mmPerPxAtThorax": view_mm / args.res,
        "mesh": args.mesh, "legThickness": args.leg_thickness,
        "whiteFloorLevel": np.mean(floor_whites, axis=0).round(3).tolist(),
    }
    (args.out / "render.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
