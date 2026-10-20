"""Find one steady stride in the simulated replay and plan N frames evenly spaced in phase.

Reads SIM_DIR/sim.npz and render.json from `render_walk.py --poses-only` and writes cycle.json:
the physics steps to render for the walk clip, the stride period, strideBL and diagnostics.

Gait phase signal: the fore-aft position of each tarsus tip in the thorax frame (a sawtooth: back
during stance, forward during swing). The stride period is the median over legs of the
autocorrelation period, refined to sub-sample precision.

Choosing the cycle: skip the replay's start-up transient and keep the stretch where the local
period is within 5% of the median. Complete cycles there that turn less than MAX_TURN_DEG and
whose end pose (all leg joints) roughly matches the start pose are ranked most compact first
(smallest box swept by the feet; frame size drives the sheet's file size). Pose is only a rough
guide to how the silhouette loops, so the top N_VERIFY are rendered around the seam and the most
compact one whose image seam ratio is ≤ IMAGE_SEAM_OK is used (else the best ratio).

Usage: python pipeline/extract_cycle.py SIM_DIR OUT_JSON [--frames 16]
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))  # render_walk, align_frames

SKIP_S = 0.2  # start-up transient of the replay (neutral pose → recorded pose)
STEADY_TOL = 0.05
LOCAL_WIN_S = 0.3
MAX_TURN_DEG = 10.0  # prefer cycles that turn less than this
POSE_SEAM_MAX = 1.5  # pose pre-filter: end-vs-start difference in frames' worth of motion
N_VERIFY = 12  # candidates checked on rendered images
VERIFY_RES = 800
SHEET_BL_PX = 96
IMAGE_SEAM_OK = 1.1  # margin under pipeline test 2's 1.5 (this check uses 2 neighbour pairs, the test 15)
PERIOD_SEARCH = 0.08  # also try periods within ±8% of the median for each start


def estimate_period(signal, fs, min_hz=2.0, max_hz=40.0):
    """Period (s) of a roughly periodic signal from its autocorrelation.

    Takes the highest autocorrelation peak with lag in [1/max_hz, 1/min_hz] and refines it with a
    parabola through the peak and its neighbours.
    """
    x = np.asarray(signal, np.float64)
    x = x - x.mean()
    n = len(x)
    f = np.fft.rfft(x, 2 * n)
    # Unbiased: divide each lag by its overlap, otherwise the (1 − lag/n) taper pulls the peak to
    # shorter lags (~2% for a sine over 20 periods).
    acf = np.fft.irfft(f * np.conj(f))[:n] / (n - np.arange(n))
    acf /= acf[0] if acf[0] > 0 else 1
    lo = max(1, int(np.floor(fs / max_hz)))
    hi = min(n // 2, int(np.ceil(fs / min_hz)))  # long lags have too little overlap to trust
    # The first peak that reaches 90% of the best peak, so a harmonic at 2T can't win over T.
    seg = acf[lo:hi + 1]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1]]
    if not peaks:
        raise ValueError("no autocorrelation peak in range")
    best = max(seg[i] for i in peaks)
    if best <= 0:
        raise ValueError("no positive autocorrelation peak: not periodic")
    k = lo + next(i for i in peaks if seg[i] >= 0.9 * best)
    # That picks the hump at the fundamental; noise can put small local maxima on its flank, so
    # take the hump's actual maximum.
    span = slice(max(lo, int(0.8 * k)), min(hi, int(1.25 * k)) + 1)
    k = span.start + int(np.argmax(acf[span]))
    coarse = k / fs
    # Refine with the spectrum: the autocorrelation peak of a short noisy signal is only good to a
    # few percent; the windowed, zero-padded spectral peak near 1/coarse is much sharper.
    m = 16 * n
    spec = np.abs(np.fft.rfft(x * np.hanning(n), m))
    freqs = np.fft.rfftfreq(m, 1 / fs)
    band = np.nonzero((freqs >= 0.8 / coarse) & (freqs <= 1.25 / coarse))[0]
    j = band[np.argmax(spec[band])]
    a, b, c = np.log(spec[j - 1: j + 2] + 1e-300)
    denom = a - 2 * b + c
    shift = 0.5 * (a - c) / denom if denom != 0 else 0.0
    return 1 / ((j + shift) * fs / m)


def yaw_of(quat):
    q = np.asarray(quat)
    return np.unwrap(np.arctan2(2 * (q[:, 0] * q[:, 3] + q[:, 1] * q[:, 2]), 1 - 2 * (q[:, 2] ** 2 + q[:, 3] ** 2)))


def find_candidates(sim, frames):
    """Complete steady cycles, ranked for the image check: straight and roughly seamless by pose,
    most compact first. Returns (context, [(footbox, poseSeam, turn, start_index, n), ...])."""
    t = sim["t"]
    fs = 1 / np.median(np.diff(t))
    fore = sim["tarsi"][:, :, 0]  # (T, 6) fore-aft tarsus position in the thorax frame
    skip = int(round(SKIP_S * fs))

    leg_periods = [estimate_period(fore[skip:, j], fs) for j in range(fore.shape[1])]
    period = float(np.median(leg_periods))

    # Local period in sliding windows (median over legs) to find the steady stretch.
    win = int(round(LOCAL_WIN_S * fs))
    hop = int(round(0.02 * fs))
    steady = np.zeros(len(t), bool)

    def local_period(s, j):
        try:
            return estimate_period(fore[s:s + win, j], fs)
        except ValueError:  # irregular window: no peak at all
            return np.nan

    for s in range(skip, len(t) - win, hop):
        local = np.nanmedian([local_period(s, j) for j in range(fore.shape[1])])
        if abs(local - period) / period <= STEADY_TOL:
            steady[s:s + win] = True

    yaw = yaw_of(sim["thorax_quat"])
    tarsi = sim["tarsi"]
    # Gait state for the pose pre-filter: every leg joint in 3D, in the thorax frame.
    joints = sim["leg_joints"]
    pose = (joints - joints.mean(0)).reshape(len(t), -1)
    step_len = np.median(np.linalg.norm(np.diff(pose, axis=0), axis=1)) * period * fs / frames

    cands = []
    for p in np.linspace(1 - PERIOD_SEARCH, 1 + PERIOD_SEARCH, 17) * period:
        n = int(round(p * fs))
        for s in range(skip, len(t) - n, max(1, hop // 4)):
            if not steady[s:s + n + 1].all():
                continue
            seam = np.linalg.norm(pose[s + n] - pose[s]) / step_len  # 1.0 = one frame's worth of motion
            turn = abs(np.degrees(yaw[s + n] - yaw[s]))
            feet = tarsi[s:s + n]
            footbox = np.ptp(feet[:, :, 0]) * 2 * np.abs(feet[:, :, 1]).max()  # mm², fore-aft × lateral
            cands.append((footbox, seam, turn, s, n))
    if not cands:
        raise SystemExit("no complete steady cycle found")
    good = sorted(c for c in cands if c[1] < POSE_SEAM_MAX and c[2] < MAX_TURN_DEG) or sorted(cands, key=lambda c: c[1])
    # Drop near-duplicates (starts within 2 ms of an already kept candidate).
    ranked = []
    for c in good:
        if all(abs(c[3] - r[3]) > 0.002 * fs for r in ranked):
            ranked.append(c)
        if len(ranked) == N_VERIFY:
            break
    ctx = {"fs": fs, "period": period, "legPeriods": leg_periods, "steadyFraction": float(steady[skip:].mean())}
    return ctx, ranked


def frame_index(start, n, k, frames):
    return start + int(round(k * n / frames))


def image_seams(sim, ranked, frames, body_length_mm):
    """Seam ratio of each candidate on rendered silhouettes, as pipeline test 2 measures it:
    |α(frame N−1) − α(frame 0)| over the mean of the neighbouring |α(1) − α(0)| and
    |α(N−1) − α(N−2)|, after head-up alignment and downscaling to sheet scale."""
    import tempfile
    from types import SimpleNamespace

    from PIL import Image

    import render_walk as rw
    from align_frames import LABELS, affine_to_canvas, body_axis, centroid

    args = SimpleNamespace(out=Path(tempfile.mkdtemp(prefix="seam_")), res=VERIFY_RES, view_mm=6.6,
                           leg_thickness=1.0, mesh="simplified")
    run = rw.Run(args)
    renderer = rw.OverheadRenderer(run.model, args.res, run.cam)
    scale = SHEET_BL_PX / (0.95 * body_length_mm / (args.view_mm / args.res))  # ≈ sheet px per render px
    out_size = (round(args.res * scale),) * 2
    centre = np.array([args.res / 2, args.res / 2])

    wanted = {}
    for ci, (_, _, _, s, n) in enumerate(ranked):
        for k in (0, 1, frames - 2, frames - 1):
            wanted.setdefault(int(sim["step"][frame_index(s, n, k, frames)]), []).append((ci, k))
    alphas = {}

    def grab(i):
        if i in wanted:
            rgba, label, _ = renderer.render(run.data)
            data = affine_to_canvas(centroid(label == LABELS["thorax"]), body_axis(label), centre)
            a = Image.fromarray(rgba[..., 3].astype(np.float32) / 255)
            a = a.transform(a.size, Image.AFFINE, data, resample=Image.BICUBIC).resize(out_size, Image.BOX)
            for key in wanted[i]:
                alphas[key] = np.clip(np.asarray(a), 0, 1)

    run.replay(max(wanted), grab)
    ratios = []
    for ci in range(len(ranked)):
        a0, a1, a2, a3 = (alphas[(ci, k)] for k in (0, 1, frames - 2, frames - 1))
        adjacent = (np.abs(a1 - a0).mean() + np.abs(a3 - a2).mean()) / 2
        ratios.append(float(np.abs(a3 - a0).mean() / adjacent))
    return ratios


def plan_cycle(sim, body_length_mm, frames):
    ctx, ranked = find_candidates(sim, frames)
    ratios = image_seams(sim, ranked, frames, body_length_mm)
    ok = [i for i, r in enumerate(ratios) if r <= IMAGE_SEAM_OK]
    pick = ok[0] if ok else int(np.argmin(ratios))  # ranked most compact first
    footbox, seam, turn, start, n = ranked[pick]
    fs = ctx["fs"]
    xy = sim["thorax_pos"][:, :2]
    steps = [int(sim["step"][frame_index(start, n, k, frames)]) for k in range(frames)]
    return {
        "frames": frames,
        "walkSteps": steps,
        "startStep": int(sim["step"][start]),
        "periodSteps": int(sim["step"][start + n] - sim["step"][start]),
        "periodS": n / fs,
        "strideHz": fs / n,
        "medianPeriodS": ctx["period"],
        "legPeriodsS": [float(v) for v in ctx["legPeriods"]],
        "strideMm": float(np.linalg.norm(xy[start + n] - xy[start])),
        # Diagnostic only: build_sheet.py scales by the visible (rendered) body length instead.
        "bodyLengthMmGeometric": body_length_mm,
        "imageSeamRatio": ratios[pick],
        "poseSeamFrames": float(seam),
        "footBoxMm2": float(footbox),
        "turnDeg": float(turn),
        "steadyFraction": ctx["steadyFraction"],
        "candidates": [{"startStep": int(sim["step"][c[3]]), "periodS": c[4] / fs, "footBoxMm2": float(c[0]),
                        "imageSeamRatio": r} for c, r in zip(ranked, ratios)],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sim_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--frames", type=int, default=16)
    args = ap.parse_args()
    sim = dict(np.load(args.sim_dir / "sim.npz"))
    meta = json.loads((args.sim_dir / "render.json").read_text())
    plan = plan_cycle(sim, meta["bodyLengthMm"], args.frames)
    args.out.write_text(json.dumps(plan, indent=1))
    print(json.dumps({k: v for k, v in plan.items() if k not in ("walkSteps", "legPeriodsS", "candidates")}, indent=1))


if __name__ == "__main__":
    main()
