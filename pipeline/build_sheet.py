"""Downscale aligned frames, pack the clips into a sprite sheet and write its metadata.

Reads ALIGNED_DIR (align_frames.py) and CYCLE_JSON (extract_cycle.py); writes OUT_DIR/
fly-sheet.png (palette PNG), fly-sheet.webp (lossless WebP of the same palette image) and
fly-sheet.json (PLAN.md §3 schema). Rows: 0 walk, 1 idle.

Scale: the visible body length (head tip to abdomen tip, wings excluded, measured on the
orthographic renders by align_frames.py) becomes --body-length px; strideBL uses the same length. Frames are rectangles holding every frame of every clip with a transparent
margin; the anchor (thorax centroid) sits at a whole-pixel coordinate. Downscaling is area
averaging on premultiplied colour, so edges have no dark fringes.

Usage: python pipeline/build_sheet.py ALIGNED_DIR CYCLE_JSON OUT_DIR [--body-length 96] [--colors 64]
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

MARGIN = 2  # transparent output pixels around the union of all frames
CLIPS = ("walk", "idle")


def downscale_box(channel, box, size):
    """Area-average a float32 2D array over a (fractional) box to `size` (w, h)."""
    return np.asarray(Image.fromarray(channel.astype(np.float32)).resize(size, Image.BOX, box=box))


def downscale_rgba(rgba, box, size):
    arr = np.asarray(rgba).astype(np.float32) / 255
    arr[..., :3] *= arr[..., 3:4]
    out = np.dstack([downscale_box(arr[..., c], box, size) for c in range(4)])
    a = out[..., 3:4]
    rgb = np.where(a > 1e-4, out[..., :3] / np.maximum(a, 1e-4), 0)
    return np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])


def frame_geometry(align, scale):
    """Output frame size and anchor, and the hi-res box each frame is resampled from."""
    ax, ay = align["anchor"]
    x0, y0, x1, y1 = align["unionBBox"]
    left = math.ceil((ax - x0) * scale) + MARGIN
    top = math.ceil((ay - y0) * scale) + MARGIN
    w = left + math.ceil((x1 - ax) * scale) + MARGIN
    h = top + math.ceil((y1 - ay) * scale) + MARGIN
    box = (ax - left / scale, ay - top / scale, ax + (w - left) / scale, ay + (h - top) / scale)
    return (w, h), (left, top), box


def build(aligned_dir, cycle, out_dir, body_length_px=96, colors=64):
    aligned_dir, out_dir = Path(aligned_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    align = json.loads((aligned_dir / "align.json").read_text())
    scale = body_length_px / align["bodyLengthPx"]  # output px per render px
    body_mm = align["bodyLengthMm"]
    stride_bl = cycle["strideMm"] / body_mm
    (w, h), anchor, box = frame_geometry(align, scale)

    clips = {c: sorted(aligned_dir.glob(f"{c}_[0-9][0-9].png")) for c in CLIPS}
    ncols = max(len(v) for v in clips.values())
    sheet = np.zeros((h * len(CLIPS), w * ncols, 4), np.float32)
    for row, clip in enumerate(CLIPS):
        for col, path in enumerate(clips[clip]):
            sheet[row * h:(row + 1) * h, col * w:(col + 1) * w] = downscale_rgba(Image.open(path), box, (w, h))
    rgba = Image.fromarray((sheet * 255).round().astype(np.uint8), "RGBA")

    # Palette quantisation (octree supports alpha; deterministic), no dithering for clean loops.
    pal = rgba.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    png_path = out_dir / "fly-sheet.png"
    pal.save(png_path, optimize=True)
    # Lossless WebP of the quantised pixels: same image, smaller file (colour-indexing transform).
    webp_path = out_dir / "fly-sheet.webp"
    pal.convert("RGBA").save(webp_path, lossless=True, quality=100, method=6, exact=True)

    meta = {
        "version": 1,
        "image": "fly-sheet.webp",
        "frameWidth": w,
        "frameHeight": h,
        "anchor": list(anchor),
        "bodyLengthPx": body_length_px,
        "clips": {
            "walk": {"row": 0, "frames": len(clips["walk"]), "strideBL": round(stride_bl, 4), "loop": True},
            "idle": {"row": 1, "frames": len(clips["idle"])},
        },
        "source": {
            "generator": "flygym",
            "flygymVersion": "2.1.0",
            "controller": "kinematic replay of recorded walking (flygym_demo.spotlight_data.MotionSnippet)",
            "notes": (f"NeuroMechFly, orthographic overhead camera; one stride of {cycle['periodS'] * 1000:.1f} ms "
                      f"({cycle['strideHz']:.1f} Hz) at {stride_bl * cycle['strideHz']:.1f} BL/s real speed; "
                      f"visible body length {body_mm:.2f} mm; {colors}-colour palette"),
        },
    }
    (out_dir / "fly-sheet.json").write_text(json.dumps(meta, indent=2) + "\n")
    return meta, {"scale": scale, "box": box, "pngBytes": png_path.stat().st_size,
                  "webpBytes": webp_path.stat().st_size}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aligned_dir", type=Path)
    ap.add_argument("cycle", type=Path)
    ap.add_argument("out_dir", type=Path)
    ap.add_argument("--body-length", type=int, default=96)
    ap.add_argument("--colors", type=int, default=64)
    args = ap.parse_args()
    meta, info = build(args.aligned_dir, json.loads(args.cycle.read_text()), args.out_dir,
                       args.body_length, args.colors)
    print(json.dumps({"frame": [meta["frameWidth"], meta["frameHeight"]], "anchor": meta["anchor"],
                      "pngKB": round(info["pngBytes"] / 1024, 1), "webpKB": round(info["webpBytes"] / 1024, 1)}))


if __name__ == "__main__":
    main()
