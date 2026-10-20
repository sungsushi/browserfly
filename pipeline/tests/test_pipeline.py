"""Pipeline tests 1–7 (PLAN.md M4). Tests 2–7 run the full pipeline (about 30 s per build)."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from align_frames import BODY, LABELS, axis_angle_deg, body_axis  # noqa: E402
from build_all import DIST, SHEET_FILES, build_all  # noqa: E402
from build_sheet import downscale_box, frame_geometry  # noqa: E402
from extract_cycle import estimate_period  # noqa: E402

BUDGET_WEBP = 30 * 1024
BUDGET_PNG = 40 * 1024


@pytest.fixture(scope="session")
def build(tmp_path_factory):
    out = tmp_path_factory.mktemp("build1")
    build_all(out)
    return out


@pytest.fixture(scope="session")
def meta(build):
    return json.loads((build / "sheet" / "fly-sheet.json").read_text())


@pytest.fixture(scope="session")
def frames(build, meta):
    """{clip: [float RGBA array in 0..1, ...]} cut from the PNG sheet."""
    sheet = np.asarray(Image.open(build / "sheet" / "fly-sheet.png").convert("RGBA")).astype(np.float32) / 255
    w, h = meta["frameWidth"], meta["frameHeight"]
    return {name: [sheet[c["row"] * h:(c["row"] + 1) * h, k * w:(k + 1) * w] for k in range(c["frames"])]
            for name, c in meta["clips"].items()}


@pytest.fixture(scope="session")
def geometry(build, meta):
    """Output scale and the hi-res resampling box, as used by build_sheet."""
    align = json.loads((build / "aligned" / "align.json").read_text())
    scale = meta["bodyLengthPx"] / align["bodyLengthPx"]
    size, anchor, box = frame_geometry(align, scale)
    assert size == (meta["frameWidth"], meta["frameHeight"]) and list(anchor) == meta["anchor"]
    return {"size": size, "box": box, "align": align}


def aligned_labels(build, meta):
    for clip, c in meta["clips"].items():
        for k in range(c["frames"]):
            yield f"{clip}_{k:02d}", np.array(Image.open(build / "aligned" / f"{clip}_{k:02d}_label.png"))


# 1. Period detection -------------------------------------------------------------------------------

@pytest.mark.parametrize("shape", ["sine", "square", "sawtooth"])
@pytest.mark.parametrize("period,fs", [(0.0917, 1000), (0.25, 330), (0.05, 10000)])
def test_1_period_detection(shape, period, fs):
    rng = np.random.default_rng(1)
    t = np.arange(int(2.0 * fs)) / fs
    ph = (t / period + 0.37) % 1
    x = {"sine": np.sin(2 * np.pi * ph), "square": np.where(ph < 0.6, 1.0, -1.0), "sawtooth": 2 * ph - 1}[shape]
    x = x + 0.3 * rng.standard_normal(len(t))
    assert abs(estimate_period(x, fs) - period) / period < 0.01


# 2. Loop seam --------------------------------------------------------------------------------------

def test_2_loop_seam(frames):
    a = [f[..., 3] for f in frames["walk"]]
    adjacent = [np.abs(a[i + 1] - a[i]).mean() for i in range(len(a) - 1)]
    seam = np.abs(a[0] - a[-1]).mean()
    assert seam <= 1.5 * np.median(adjacent), (seam, np.median(adjacent))


# 3. Alignment --------------------------------------------------------------------------------------

def test_3_alignment(build, meta, geometry):
    ax, ay = meta["anchor"]
    for name, label in aligned_labels(build, meta):
        # Thorax centroid at output resolution: downscale the thorax mask with the sheet's own box.
        cov = downscale_box((label == LABELS["thorax"]).astype(np.float32), geometry["box"], geometry["size"])
        ys, xs = np.mgrid[0:cov.shape[0], 0:cov.shape[1]]
        cx = ((xs + 0.5) * cov).sum() / cov.sum()
        cy = ((ys + 0.5) * cov).sum() / cov.sum()
        assert np.hypot(cx - ax, cy - ay) <= 1.0, (name, cx, cy)
        # Body axis within 3° of vertical, head up.
        axis = body_axis(label)
        assert abs(axis_angle_deg(axis)) <= 3.0, (name, axis_angle_deg(axis))
        head_y = np.nonzero(label == LABELS["head"])[0].mean()
        thorax_y = np.nonzero(label == LABELS["thorax"])[0].mean()
        assert head_y < thorax_y, name


# 4. Alpha ------------------------------------------------------------------------------------------

def test_4_alpha(frames):
    for clip, fr in frames.items():
        for k, f in enumerate(fr):
            a = f[..., 3]
            assert a[0, 0] == a[0, -1] == a[-1, 0] == a[-1, -1] == 0, (clip, k, "corner")
            assert (a > 0.5).any(), (clip, k, "empty")
            ring = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
            assert ring.max() == 0, (clip, k, "border ring")
    area = [np.count_nonzero(f[..., 3] > 0.5) for f in frames["walk"]]
    assert (max(area) - min(area)) / max(area) < 0.15, area


# 5. Metadata ---------------------------------------------------------------------------------------

def check_schema(meta):
    assert meta["version"] == 1
    assert isinstance(meta["image"], str) and meta["image"].endswith(".webp")
    for k in ("frameWidth", "frameHeight", "bodyLengthPx"):
        assert isinstance(meta[k], int) and meta[k] > 0, k
    assert len(meta["anchor"]) == 2 and all(isinstance(v, (int, float)) for v in meta["anchor"])
    assert 0 <= meta["anchor"][0] < meta["frameWidth"] and 0 <= meta["anchor"][1] < meta["frameHeight"]
    clips = meta["clips"]
    assert {"walk", "idle"} <= set(clips)
    rows = [c["row"] for c in clips.values()]
    assert sorted(rows) == list(range(len(rows))), "rows must be 0..n-1, one per clip"
    for name, c in clips.items():
        assert isinstance(c["row"], int) and isinstance(c["frames"], int) and c["frames"] > 0, name
    assert isinstance(clips["walk"]["strideBL"], (int, float)) and clips["walk"]["loop"] is True
    src = meta["source"]
    assert src["generator"] == "flygym" and src["flygymVersion"] and src["controller"]


def test_5_metadata(build, meta, geometry):
    check_schema(meta)
    sheet = Image.open(build / "sheet" / "fly-sheet.png")
    webp = Image.open(build / "sheet" / "fly-sheet.webp")
    assert sheet.size == webp.size
    nrows = len(meta["clips"])
    assert meta["frameWidth"] * max(c["frames"] for c in meta["clips"].values()) <= sheet.width
    assert meta["frameHeight"] * nrows == sheet.height
    assert 0.1 < meta["clips"]["walk"]["strideBL"] < 1.5
    # Body (head + thorax + abdomen, wings excluded) extent along the body axis at output resolution.
    for name, label in aligned_labels(build, meta):
        cov = downscale_box(np.isin(label, BODY).astype(np.float32), geometry["box"], geometry["size"])
        rows = np.nonzero((cov >= 0.5).any(1))[0]
        extent = rows.max() - rows.min() + 1
        assert abs(extent - meta["bodyLengthPx"]) <= 2, (name, extent)


# 6. Budget -----------------------------------------------------------------------------------------

def test_6_budget(build):
    assert (build / "sheet" / "fly-sheet.webp").stat().st_size <= BUDGET_WEBP
    assert (build / "sheet" / "fly-sheet.png").stat().st_size <= BUDGET_PNG


# 7. Reproducibility --------------------------------------------------------------------------------

def test_7_reproducibility(build, tmp_path):
    second = build_all(tmp_path / "build2")
    first = build / "sheet"
    assert (first / "fly-sheet.json").read_bytes() == (second / "fly-sheet.json").read_bytes()
    for name in ("fly-sheet.png", "fly-sheet.webp"):
        a = np.asarray(Image.open(first / name).convert("RGBA"))
        b = np.asarray(Image.open(second / name).convert("RGBA"))
        assert np.array_equal(a, b), name


def test_dist_matches_pipeline(build):
    """The committed dist/ sheet is the current pipeline output (rerun build_all.py --dist if not)."""
    for name in SHEET_FILES:
        if name.endswith(".json"):
            assert (DIST / name).read_bytes() == (build / "sheet" / name).read_bytes(), name
        else:
            a = np.asarray(Image.open(DIST / name).convert("RGBA"))
            b = np.asarray(Image.open(build / "sheet" / name).convert("RGBA"))
            assert np.array_equal(a, b), name
