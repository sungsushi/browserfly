"""Align rendered frames: thorax centroid at a fixed point, body axis vertical, head up.

Reads FRAMES_DIR from `render_walk.py --plan` (walk_XX.png / idle_XX.png with _label maps) and
writes OUT_DIR/<clip>_XX.png (straight-alpha RGBA) and <clip>_XX_label.png on a canvas of the same
size, with the thorax centroid at the canvas centre, plus align.json (anchor, union bounding box of
all frames, per-frame corrections).

Per frame:
  - thorax centroid: mean of the thorax-label pixel centres;
  - body axis: principal axis (PCA) of the head + thorax + abdomen pixels, pointing towards the
    head centroid;
  - the inverse affine (rotation about the centroid) is applied to premultiplied channels with
    bicubic sampling, and to the labels with nearest-neighbour sampling;
  - visible body length: vertical extent of the head + thorax + abdomen labels after alignment,
    after a morphological opening ~1% of the body length wide (about one sprite pixel), so slivers
    too thin to survive at sprite size don't count. The median over frames is the scale unit (BL).
    It is ~10% shorter than the extent of the mesh vertices: some abdomen-tip vertices are never
    visible from above, and the head and abdomen tips are slivers.

Coordinates are continuous, with pixel i covering [i, i + 1) and its centre at i + 0.5.

Usage: python pipeline/align_frames.py FRAMES_DIR OUT_DIR
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

LABELS = {"background": 0, "thorax": 1, "head": 2, "abdomen": 3, "other": 4, "leg": 5, "wing": 6}
BODY = (LABELS["thorax"], LABELS["head"], LABELS["abdomen"])


def centroid(mask):
    ys, xs = np.nonzero(mask)
    return np.array([xs.mean() + 0.5, ys.mean() + 0.5])


def body_axis(label):
    """Unit vector (x, y in image coordinates) along the body, pointing to the head."""
    ys, xs = np.nonzero(np.isin(label, BODY))
    pts = np.column_stack([xs, ys]).astype(np.float64) + 0.5
    m = pts.mean(0)
    axis = np.linalg.eigh(np.cov((pts - m).T))[1][:, -1]
    if (centroid(label == LABELS["head"]) - m) @ axis < 0:
        axis = -axis
    return axis / np.linalg.norm(axis)


def body_extent_px(label):
    """Vertical extent of the body labels, ignoring features thinner than ~1% of that extent."""
    mask = np.isin(np.asarray(label), BODY)
    rows = np.nonzero(mask.any(1))[0]
    k = int(round(0.01 * (rows.max() - rows.min() + 1))) | 1  # odd kernel
    m = Image.fromarray((mask * 255).astype(np.uint8))
    opened = np.asarray(m.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))) > 0
    rows = np.nonzero(opened.any(1))[0]
    return int(rows.max() - rows.min() + 1)


def axis_angle_deg(axis):
    """Signed angle of `axis` from straight up (−y), in degrees."""
    return float(np.degrees(np.arctan2(axis[0], -axis[1])))


def affine_to_canvas(center_in, axis, center_out):
    """PIL AFFINE data mapping output (canvas) coordinates to input coordinates: the input body
    axis `axis` ends up pointing up and `center_in` lands on `center_out`."""
    ax, ay = axis
    # R maps "up" (0, −1) to axis: input = center_in + R (output − center_out).
    R = np.array([[-ay, -ax], [ax, -ay]])
    t = center_in - R @ center_out
    return (R[0, 0], R[0, 1], t[0], R[1, 0], R[1, 1], t[1])


def transform_rgba(rgba, data):
    """Premultiplied bicubic transform; returns straight-alpha uint8 RGBA."""
    arr = np.asarray(rgba).astype(np.float32) / 255
    arr[..., :3] *= arr[..., 3:4]
    size = rgba.size
    chans = [np.asarray(Image.fromarray(arr[..., c]).transform(size, Image.AFFINE, data, resample=Image.BICUBIC))
             for c in range(4)]
    out = np.clip(np.dstack(chans), 0, 1)
    a = out[..., 3:4]
    rgb = np.where(a > 1e-4, out[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.dstack([np.clip(rgb, 0, 1), a])
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def align_dir(frames_dir, out_dir):
    frames_dir, out_dir = Path(frames_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    names = sorted(p.stem for p in frames_dir.glob("*.png") if re.fullmatch(r"(walk|idle)_\d+", p.stem))
    if not names:
        raise SystemExit(f"no walk_XX/idle_XX frames in {frames_dir}")
    meta = json.loads((frames_dir / "render.json").read_text())
    size = Image.open(frames_dir / f"{names[0]}.png").size
    center_out = np.array(size, np.float64) / 2
    union = None
    per_frame = {}
    for name in names:
        rgba = Image.open(frames_dir / f"{name}.png")
        label = np.array(Image.open(frames_dir / f"{name}_label.png"))
        c = centroid(label == LABELS["thorax"])
        axis = body_axis(label)
        data = affine_to_canvas(c, axis, center_out)
        aligned = transform_rgba(rgba, data)
        aligned_label = Image.fromarray(label).transform(size, Image.AFFINE, data, resample=Image.NEAREST)
        aligned.save(out_dir / f"{name}.png")
        aligned_label.save(out_dir / f"{name}_label.png")
        bbox = aligned.getchannel("A").point(lambda v: 255 if v > 1 else 0).getbbox()
        union = bbox if union is None else (min(union[0], bbox[0]), min(union[1], bbox[1]),
                                            max(union[2], bbox[2]), max(union[3], bbox[3]))
        per_frame[name] = {"thoraxIn": c.tolist(), "axisAngleDeg": axis_angle_deg(axis),
                           "bodyExtentPx": body_extent_px(aligned_label)}
    body_px = float(np.median([f["bodyExtentPx"] for f in per_frame.values()]))
    info = {"canvas": list(size), "anchor": center_out.tolist(), "unionBBox": list(union),
            "mmPerPx": meta["mmPerPx"], "bodyLengthPx": body_px, "bodyLengthMm": body_px * meta["mmPerPx"],
            "frames": per_frame}
    (out_dir / "align.json").write_text(json.dumps(info, indent=1))
    return info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_dir", type=Path)
    ap.add_argument("out_dir", type=Path)
    args = ap.parse_args()
    info = align_dir(args.frames_dir, args.out_dir)
    angles = [f["axisAngleDeg"] for f in info["frames"].values()]
    print(f"aligned {len(angles)} frames; raw axis angles {min(angles):.1f}..{max(angles):.1f} deg; "
          f"union bbox {info['unionBBox']} on canvas {info['canvas']}")


if __name__ == "__main__":
    main()
