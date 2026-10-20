"""Visual QA for the sprite pipeline.

`phase0` (M3): leg readability at web sizes for three treatments. Reads two render_walk.py
default-mode outputs (normal legs and thickened legs) and writes:
  OUT/phase0_contact_sheet.png  rows: plain, plain + 1 px outline, thickened legs;
                                columns: body length 32/48/64/96/128 px; each cell shows the
                                sprite at 1x on a light and a dark page and at 4x (nearest).
  OUT/phase0_preview.html       self-contained page: one stride cycle walking a smooth path,
                                with treatment, size and playback-speed controls.
  OUT/phase0_stats.json         stride frequency, stride length, body length, sheet sizes.

`final` (M4): QA of the finished sheet. Reads fly-sheet.json (+ the PNG next to it) and writes:
  OUT/final_contact.png         the sheet at 1x on light and dark pages, and at 4x (nearest) with
                                the frame grid and the anchor marked;
  OUT/<clip>_1x.webp, _4x.webp  animated previews of each clip (walk at the rev 4 default walking
                                speed, so the stride plays at its on-screen rate; idle at 1 s/frame);
  OUT/final_preview.html        self-contained page: the sheet walking a path, drawn the way the
                                runtime will draw it (anchor offset, rotation θ + π/2).

Usage: python pipeline/contact_sheet.py phase0 PLAIN_DIR THICK_DIR OUT_DIR [--frames 16]
       python pipeline/contact_sheet.py final SHEET_JSON OUT_DIR
"""
import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from flygym_demo.spotlight_data import MotionSnippet

SIZES = [32, 48, 64, 96, 128]
PREVIEW_SIZES = [48, 96, 128]
LIGHT = (250, 248, 243, 255)
DARK = (35, 35, 40, 255)
OUTLINE_RGB = (40, 28, 16)
LABEL_WING = 6  # render_walk.LABELS["wing"]
DEFAULT_SPEED_BL = 1.2  # PLAN.md rev 4 default walking speed


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p0 = sub.add_parser("phase0", help="M3 leg-readability contact sheet and preview")
    p0.add_argument("plain", type=Path)
    p0.add_argument("thick", type=Path)
    p0.add_argument("out", type=Path)
    p0.add_argument("--frames", type=int, default=16, help="frames per stride in the preview")
    fin = sub.add_parser("final", help="M4 QA of the finished sprite sheet")
    fin.add_argument("sheet", type=Path, help="fly-sheet.json")
    fin.add_argument("out", type=Path)
    return ap.parse_args()


def yaw_of(poses):
    q = poses[:, 4:8]
    return np.arctan2(2 * (q[:, 0] * q[:, 3] + q[:, 1] * q[:, 2]), 1 - 2 * (q[:, 2] ** 2 + q[:, 3] ** 2))


def stride_frequency():
    """Stepping frequency (Hz): median over legs of the dominant frequency of the claw's
    fore-aft position, above 2 Hz (slower components are turning drift), zero-padded 8x."""
    s = MotionSnippet()
    x = s.fwdkin_egoxyz  # (T, 6 legs x 5 keypoints, 3); keypoint 4 of each leg is the claw
    freqs = []
    for leg in range(len(s.legs)):
        sig = x[:, leg * 5 + 4, 0]
        n = 8 * len(sig)
        spec = np.abs(np.fft.rfft((sig - sig.mean()) * np.hanning(len(sig)), n=n))
        f = np.fft.rfftfreq(n, 1 / s.data_fps)
        freqs.append(f[f > 2][spec[f > 2].argmax()])
    return float(np.median(freqs))


class Walk:
    """A render_walk.py output directory, aligned head-up around the thorax."""

    def __init__(self, d):
        self.dir = Path(d)
        self.meta = json.loads((self.dir / "render.json").read_text())
        self.poses = np.load(self.dir / "poses.npy")
        self.yaw = yaw_of(self.poses)

    def frame(self, k):
        """(RGBA, wing-free alpha) rotated head-up; the thorax stays at the image centre."""
        rgba = Image.open(self.dir / f"rgba_{k:04d}.png")
        label = np.array(Image.open(self.dir / f"label_{k:04d}.png"))
        a = np.array(rgba.getchannel("A"))
        no_wing = Image.fromarray(np.where(label == LABEL_WING, 0, a).astype(np.uint8))
        # The camera keeps the world orientation (world +x up); undo the body yaw.
        deg = -np.degrees(self.yaw[k])
        return (rgba.rotate(deg, resample=Image.BICUBIC),
                no_wing.rotate(deg, resample=Image.BICUBIC))


def body_length_px(rgba):
    """Head tip to abdomen tip, wings excluded: the contiguous run of opaque pixels through the
    thorax (image centre) in a narrow central column band. Wing-only pixels are translucent."""
    a = np.asarray(rgba.getchannel("A"))
    h, w = a.shape
    col = a[:, w // 2 - w // 60: w // 2 + w // 60].max(1) >= 235
    lo = hi = h // 2
    while lo > 0 and col[lo - 1]:
        lo -= 1
    while hi < h - 1 and col[hi + 1]:
        hi += 1
    return int(hi - lo)


def downscale(rgba, size):
    """Premultiplied area averaging (no dark fringes), to a square of `size` px."""
    arr = np.asarray(rgba).astype(np.float32) / 255
    arr[..., :3] *= arr[..., 3:4]
    chans = [np.asarray(Image.fromarray(arr[..., c]).resize((size, size), Image.BOX)) for c in range(4)]
    r = np.dstack(chans)
    a = r[..., 3:4]
    rgb = np.where(a > 1e-4, r[..., :3] / np.maximum(a, 1e-4), 0)
    out = np.dstack([np.clip(rgb, 0, 1), a])
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")


def with_outline(sprite, no_wing_alpha):
    """1 px dark outline around body and legs (not wings), drawn under the sprite."""
    ring = no_wing_alpha.filter(ImageFilter.MaxFilter(3))
    out = Image.new("RGBA", sprite.size, OUTLINE_RGB + (0,))
    out.putalpha(ring.point(lambda v: min(255, int(v * 0.9))))
    out.alpha_composite(sprite)
    return out


def treatments(walks, k, crop, bl_px):
    """{treatment: {size: sprite}} for frame k."""
    result = {}
    plain, plain_nw = (im.crop(crop) for im in walks["plain"].frame(k))
    thick, _ = (im.crop(crop) for im in walks["thick"].frame(k))
    side = crop[2] - crop[0]
    for name in ("plain", "outline", "thick"):
        result[name] = {}
    for bl in SIZES + [s for s in PREVIEW_SIZES if s not in SIZES]:
        n = max(1, round(side * bl / bl_px))
        p = downscale(plain, n)
        nw = np.asarray(plain_nw.resize((n, n), Image.BOX))
        result["plain"][bl] = p
        result["outline"][bl] = with_outline(p, Image.fromarray(nw))
        result["thick"][bl] = downscale(thick, n)
    return result


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def contact_sheet(cells, path, title):
    pad, gap = 24, 18
    names = {"plain": "plain (area-averaged)", "outline": "plain + 1 px outline", "thick": "thickened legs (1.8x)"}
    col_w = [max(2 * cells["plain"][bl].width + 8, 4 * cells["plain"][bl].width) for bl in SIZES]
    row_h = [max(cells[t][SIZES[-1]].height, 1) + 4 * cells[t][SIZES[-1]].height + 3 * gap for t in names]
    label_w = 210
    W = pad * 2 + label_w + sum(col_w) + gap * (len(SIZES) - 1)
    H = pad * 2 + 70 + sum(row_h)
    sheet = Image.new("RGBA", (W, H), LIGHT)
    d = ImageDraw.Draw(sheet)
    d.text((pad, pad), title, fill=(30, 30, 30), font=font(22))
    y = pad + 70
    for (t, label), rh in zip(names.items(), row_h):
        d.text((pad, y + 6), label, fill=(30, 30, 30), font=font(18))
        x = pad + label_w
        for bl, cw in zip(SIZES, col_w):
            im = cells[t][bl]
            if t == "plain":
                d.text((x, y - 30 if y > pad + 70 else y - 28), f"{bl} px", fill=(90, 90, 90), font=font(16))
            sheet.alpha_composite(im, (x, y))
            dark = Image.new("RGBA", im.size, DARK)
            dark.alpha_composite(im)
            sheet.alpha_composite(dark, (x + im.width + 8, y))
            sheet.alpha_composite(im.resize((im.width * 4, im.height * 4), Image.NEAREST), (x, y + im.height + gap))
            x += cw + gap
        y += rh
    sheet.convert("RGB").save(path)


def png_data_uri(im):
    q = im.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    buf = io.BytesIO()
    q.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(), len(buf.getvalue())


PREVIEW_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase 0 preview</title>
<style>
 :root { --bg:#faf8f3; --ink:#222; --muted:#666; --line:#ddd; }
 :root[data-theme="dark"] { --bg:#232328; --ink:#eee; --muted:#aaa; --line:#444; }
 body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; }
 main { max-width:1100px; margin:0 auto; padding:16px; }
 .controls { display:flex; flex-wrap:wrap; gap:10px 20px; align-items:center; margin:8px 0 12px; }
 canvas { width:100%; height:440px; display:block; border:1px solid var(--line); border-radius:8px; }
 .note { color:var(--muted); }
</style></head><body><main>
<h1 style="font-weight:500;font-size:20px;margin:0">Phase 0 preview: NeuroMechFly sprite</h1>
<p class="note">One recorded stride (__FRAMES__ frames) from FlyGym __FLYGYM__ kinematic replay. The frame follows distance walked, so feet don't slide.
Real stepping is ~__HZ__ Hz at ~__BLS__ BL/s.</p>
<div class="controls">
 <label>treatment <select id="t"><option value="plain">plain</option><option value="outline">plain + outline</option><option value="thick">thickened legs</option></select></label>
 <label>size <select id="size">__SIZEOPTS__</select> px</label>
 <label>walk speed <select id="v"><option value="__BLS__">real (__BLS__ BL/s)</option><option value="2.5">2.5 BL/s</option><option value="1.2" selected>1.2 BL/s (rev 4 default)</option><option value="0.6">0.6 BL/s</option></select></label>
 <label><input type="checkbox" id="dark"> dark page</label>
</div>
<canvas id="c"></canvas>
<p class="note" id="stats"></p>
</main>
<script>
const CFG = __CFG__;
const c = document.getElementById('c'), ctx = c.getContext('2d'), $ = (id) => document.getElementById(id);
const imgs = {};
for (const [t, bySize] of Object.entries(CFG.sheets)) for (const [s, v] of Object.entries(bySize)) {
  const i = new Image(); i.src = v.src; imgs[t + s] = i;
}
$('dark').onchange = () => document.documentElement.dataset.theme = $('dark').checked ? 'dark' : 'light';
function resize() { const d = devicePixelRatio || 1; c.width = c.clientWidth * d; c.height = c.clientHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', resize); resize();
const path = (s, W, H) => ({ x: W / 2 + (W / 2 - 90) * Math.sin(s), y: H / 2 + (H / 2 - 90) * Math.sin(2 * s) / 1.15 });
let s = 0, phase = 0, last = null;
function frame(now) {
  const W = c.clientWidth, H = c.clientHeight;
  const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
  const t = $('t').value, size = +$('size').value, v = +$('v').value * size;
  const p0 = path(s, W, H), p1 = path(s + 1e-3, W, H);
  const dist = v * dt; s += dist * 1e-3 / Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const p = path(s, W, H), q = path(s + 1e-3, W, H);
  phase = (phase + dist / (CFG.strideBL * size)) % 1;
  const k = Math.floor(phase * CFG.frames), sh = CFG.sheets[t][size], fw = sh.frame;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2);
  ctx.drawImage(imgs[t + size], k * fw, 0, fw, fw, -fw / 2, -fw / 2, fw, fw); ctx.restore();
  const hz = +$('v').value / CFG.strideBL;
  $('stats').textContent = `stepping ${hz.toFixed(1)} Hz on screen = ${(60 / hz).toFixed(1)} display frames per stride at 60 Hz; strideBL ${CFG.strideBL.toFixed(2)}; sheet ${(sh.bytes / 1024).toFixed(1)} KB (${CFG.frames} frames, 128-colour PNG).`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>"""


def phase0(args):
    walks = {"plain": Walk(args.plain), "thick": Walk(args.thick)}
    plain = walks["plain"]
    fps = 1 / (plain.meta["simDt"] * plain.meta["every"])
    mm_per_px = plain.meta["mmPerPx"]

    # Steadiest stretch: the 0.4 s window with the least turning; the stride starts there.
    f_step = stride_frequency()
    period = fps / f_step
    win = int(0.4 * fps)
    uy = np.unwrap(plain.yaw)
    start = int(np.abs(uy[win:] - uy[:-win]).argmin())
    n_strides = max(1, int(win // period))
    stride_mm = np.linalg.norm(plain.poses[int(start + n_strides * period), 1:3] - plain.poses[start, 1:3]) / n_strides
    speed_mm_s = stride_mm * f_step
    idx = [int(round(start + i * period / args.frames)) for i in range(args.frames)]

    # One crop for all frames and both walks: square around the thorax holding every frame.
    W = plain.frame(0)[0].width
    c = W // 2
    half = 0
    for w in walks.values():
        for k in idx:
            x0, y0, x1, y1 = w.frame(k)[0].getchannel("A").getbbox()
            half = max(half, c - x0, x1 - c, c - y0, y1 - c)
    half += 6
    crop = (c - half, c - half, c + half, c + half)
    bl_px = body_length_px(plain.frame(idx[0])[0].crop(crop))
    bl_mm = bl_px * mm_per_px
    stride_bl = stride_mm / bl_mm

    per_frame = [treatments(walks, k, crop, bl_px) for k in idx]
    # Contact sheet from the frame with the widest leg spread (most legible).
    spread = [np.count_nonzero(np.asarray(f["plain"][SIZES[-1]].getchannel("A")) > 128) for f in per_frame]
    title = (f"Phase 0: NeuroMechFly overhead, FlyGym {plain.meta['flygym']} / MuJoCo {plain.meta['mujoco']}, "
             f"body length {bl_mm:.2f} mm = {bl_px} px at render resolution")
    contact_sheet(per_frame[int(np.argmax(spread))], args.out / "phase0_contact_sheet.png", title)

    sheets, sizes_report = {}, {}
    for t in ("plain", "outline", "thick"):
        sheets[t] = {}
        for bl in PREVIEW_SIZES:
            frames = [f[t][bl] for f in per_frame]
            fw = frames[0].width
            strip = Image.new("RGBA", (fw * len(frames), fw))
            for i, im in enumerate(frames):
                strip.paste(im, (i * fw, 0))
            uri, nbytes = png_data_uri(strip)
            sheets[t][bl] = {"src": uri, "frame": fw, "bytes": nbytes}
            sizes_report[f"{t}_{bl}"] = {"framePx": fw, "png128Bytes": nbytes}

    stats = {"strideHz": f_step, "strideMm": float(stride_mm), "speedMmPerS": float(speed_mm_s),
             "bodyLengthMm": float(bl_mm), "bodyLengthPxRender": bl_px, "strideBL": float(stride_bl),
             "speedBLPerS": float(speed_mm_s / bl_mm), "cycleStartFrame": start, "framesPerStrideAtRender": period,
             "cropPxRender": 2 * half, "sheets16": sizes_report}
    (args.out / "phase0_stats.json").write_text(json.dumps(stats, indent=1))

    cfg = {"frames": args.frames, "strideBL": stride_bl, "sheets": sheets}
    html = (PREVIEW_HTML.replace("__CFG__", json.dumps(cfg))
            .replace("__FRAMES__", str(args.frames)).replace("__FLYGYM__", plain.meta["flygym"])
            .replace("__HZ__", f"{f_step:.0f}").replace("__BLS__", f"{speed_mm_s / bl_mm:.1f}")
            .replace("__SIZEOPTS__", "".join(f"<option{' selected' if s == 96 else ''}>{s}</option>" for s in PREVIEW_SIZES)))
    (args.out / "phase0_preview.html").write_text(html)
    print(json.dumps({k: v for k, v in stats.items() if k != "sheets16"}, indent=1))
    for k, v in sizes_report.items():
        print(f"  {k:12s} frame {v['framePx']:4d}px  16-frame sheet {v['png128Bytes'] / 1024:6.1f} KB")


def sheet_frames(meta, sheet):
    """{clip: [RGBA frame, ...]} cut from the sheet."""
    w, h = meta["frameWidth"], meta["frameHeight"]
    return {name: [sheet.crop((k * w, c["row"] * h, (k + 1) * w, (c["row"] + 1) * h)) for k in range(c["frames"])]
            for name, c in meta["clips"].items()}


def save_animation(frames, path, duration_ms, zoom):
    frames = [f.resize((f.width * zoom, f.height * zoom), Image.NEAREST) for f in frames]
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=int(round(duration_ms)),
                   loop=0, lossless=True, background=(0, 0, 0, 0))


FINAL_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprite sheet preview</title>
<style>
 :root { --bg:#faf8f3; --ink:#222; --muted:#666; --line:#ddd; }
 :root[data-theme="dark"] { --bg:#232328; --ink:#eee; --muted:#aaa; --line:#444; }
 body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 system-ui, sans-serif; }
 main { max-width:1100px; margin:0 auto; padding:16px; }
 .controls { display:flex; flex-wrap:wrap; gap:10px 20px; align-items:center; margin:8px 0 12px; }
 canvas { width:100%; height:460px; display:block; border:1px solid var(--line); border-radius:8px; }
 .note { color:var(--muted); }
</style></head><body><main>
<h1 style="font-weight:500;font-size:20px;margin:0">Sprite sheet preview (M4)</h1>
<p class="note">dist/fly-sheet: __W__×__H__ frames, anchor [__AX__, __AY__], __N__-frame walk (strideBL __STRIDE__), __NI__-frame idle. Every few seconds the fly stops and shows the idle clip.</p>
<div class="controls">
 <label>size <select id="size"><option>48</option><option>72</option><option selected>96</option><option>128</option></select> px</label>
 <label>walk speed <select id="v"><option value="__REAL__">real (__REAL__ BL/s)</option><option value="2.5">2.5 BL/s</option><option value="1.2" selected>1.2 BL/s (default)</option><option value="0.6">0.6 BL/s</option></select></label>
 <label><input type="checkbox" id="dark"> dark page</label>
</div>
<canvas id="c"></canvas>
</main>
<script>
const M = __META__, SRC = "__SRC__";
const img = new Image(); img.src = SRC;
const c = document.getElementById('c'), ctx = c.getContext('2d'), $ = (id) => document.getElementById(id);
$('dark').onchange = () => document.documentElement.dataset.theme = $('dark').checked ? 'dark' : 'light';
function resize() { const d = devicePixelRatio || 1; c.width = c.clientWidth * d; c.height = c.clientHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', resize); resize();
const path = (s, W, H) => ({ x: W / 2 + (W / 2 - 110) * Math.sin(s), y: H / 2 + (H / 2 - 110) * Math.sin(2 * s) / 1.15 });
let s = 0, phase = 0, last = null, mode = 'walk', timer = 4, idleFrame = 0, idleT = 0;
function frame(now) {
  const W = c.clientWidth, H = c.clientHeight;
  const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000); last = now;
  const size = +$('size').value, k = size / M.bodyLengthPx;
  timer -= dt;
  if (timer <= 0) { mode = mode === 'walk' ? 'idle' : 'walk'; timer = mode === 'walk' ? 4 + 3 * Math.random() : 1.5 + Math.random(); }
  let clip = M.clips.walk, f;
  if (mode === 'walk') {
    const dist = +$('v').value * size * dt;
    const p0 = path(s, W, H), p1 = path(s + 1e-3, W, H);
    s += dist * 1e-3 / Math.hypot(p1.x - p0.x, p1.y - p0.y);
    phase = (phase + dist / (clip.strideBL * size)) % 1;
    f = Math.floor(phase * clip.frames);
  } else {
    clip = M.clips.idle; idleT -= dt;
    if (idleT <= 0) { idleFrame = (idleFrame + 1) % clip.frames; idleT = 0.5 + 1.5 * Math.random(); }
    f = idleFrame;
  }
  const p = path(s, W, H), q = path(s + 1e-3, W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2); ctx.scale(k, k);
  ctx.drawImage(img, f * M.frameWidth, clip.row * M.frameHeight, M.frameWidth, M.frameHeight,
                -M.anchor[0], -M.anchor[1], M.frameWidth, M.frameHeight);
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>"""


def final(args):
    meta = json.loads(args.sheet.read_text())
    sheet = Image.open(args.sheet.with_name("fly-sheet.png")).convert("RGBA")
    w, h = meta["frameWidth"], meta["frameHeight"]
    ax, ay = meta["anchor"]
    pad = 20
    big = sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST)
    d = ImageDraw.Draw(big)
    for c in meta["clips"].values():
        for k in range(c["frames"]):
            x, y = k * w * 4, c["row"] * h * 4
            d.rectangle((x, y, x + w * 4 - 1, y + h * 4 - 1), outline=(120, 160, 220, 255))
            cx, cy = x + ax * 4, y + ay * 4
            d.line((cx - 10, cy, cx + 10, cy), fill=(220, 40, 120, 255))
            d.line((cx, cy - 10, cx, cy + 10), fill=(220, 40, 120, 255))
    W = max(big.width, 2 * sheet.width + pad) + 2 * pad
    H = 2 * sheet.height + big.height + 5 * pad + 30
    out = Image.new("RGBA", (W, H), LIGHT)
    ImageDraw.Draw(out).text((pad, pad), f"fly-sheet: {w}x{h} frames, anchor {meta['anchor']}, body "
                             f"{meta['bodyLengthPx']} px, clips {', '.join(meta['clips'])}",
                             fill=(30, 30, 30), font=font(18))
    y = pad + 30
    out.alpha_composite(sheet, (pad, y))
    dark = Image.new("RGBA", sheet.size, DARK)
    dark.alpha_composite(sheet)
    out.alpha_composite(dark, (pad, y + sheet.height + pad))
    out.alpha_composite(big, (pad, y + 2 * (sheet.height + pad)))
    out.convert("RGB").save(args.out / "final_contact.png")

    frames = sheet_frames(meta, sheet)
    walk = meta["clips"]["walk"]
    # One stride covers strideBL body lengths; at the default speed that takes strideBL / speed s.
    walk_ms = 1000 * walk["strideBL"] / DEFAULT_SPEED_BL / walk["frames"]
    for clip, fr in frames.items():
        for zoom in (1, 4):
            save_animation(fr, args.out / f"{clip}_{zoom}x.webp", walk_ms if clip == "walk" else 1000, zoom)
    cycle_notes = meta["source"]["notes"]
    real = cycle_notes.split(" at ")[1].split(" BL/s")[0] if " at " in cycle_notes else "6"
    src = "data:image/png;base64," + base64.b64encode(args.sheet.with_name("fly-sheet.png").read_bytes()).decode()
    html = (FINAL_HTML.replace("__META__", json.dumps(meta)).replace("__SRC__", src)
            .replace("__W__", str(w)).replace("__H__", str(h)).replace("__AX__", str(ax)).replace("__AY__", str(ay))
            .replace("__N__", str(walk["frames"])).replace("__NI__", str(meta["clips"]["idle"]["frames"]))
            .replace("__STRIDE__", f"{walk['strideBL']:.2f}").replace("__REAL__", real))
    (args.out / "final_preview.html").write_text(html)
    print(f"final_contact.png, final_preview.html and {len(frames) * 2} animations in {args.out}; "
          f"walk {walk_ms:.0f} ms/frame")


def main():
    args = parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    phase0(args) if args.cmd == "phase0" else final(args)


if __name__ == "__main__":
    main()
