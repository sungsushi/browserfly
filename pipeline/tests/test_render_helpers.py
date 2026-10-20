"""Unit tests for the geometry helpers in render_walk.py (no rendering)."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from render_walk import read_stl, thicken, write_stl  # noqa: E402


def cylinder(radius=0.1, length=2.0, n=24, offset=(0.3, -0.2, 0.0)):
    """Triangulated open cylinder along z, deliberately not centred on the origin."""
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ring = np.stack([radius * np.cos(a), radius * np.sin(a)], 1)
    lo = np.column_stack([ring, np.zeros(n)]) + offset
    hi = np.column_stack([ring, np.full(n, length)]) + offset
    tris = []
    for i in range(n):
        j = (i + 1) % n
        tris += [[lo[i], lo[j], hi[i]], [hi[i], lo[j], hi[j]]]
    return np.array(tris, np.float32)


def radial_stats(tris, centre_xy):
    v = tris.reshape(-1, 3)
    r = np.hypot(v[:, 0] - centre_xy[0], v[:, 1] - centre_xy[1])
    return r.mean(), v[:, 2].min(), v[:, 2].max()


def test_thicken_scales_radius_about_own_axis():
    tris = cylinder()
    out = thicken(tris, 1.8)
    r0, z0lo, z0hi = radial_stats(tris, (0.3, -0.2))
    r1, z1lo, z1hi = radial_stats(out, (0.3, -0.2))
    assert abs(r1 / r0 - 1.8) < 1e-4  # thicker, around the same centre line (not the origin)
    assert abs(z1lo - z0lo) < 1e-5 and abs(z1hi - z0hi) < 1e-5  # length unchanged


def test_thicken_identity():
    tris = cylinder()
    assert np.allclose(thicken(tris, 1.0), tris, atol=1e-6)


def test_stl_roundtrip(tmp_path):
    tris = cylinder()
    p = tmp_path / "c.stl"
    write_stl(p, tris)
    assert np.allclose(read_stl(p), tris)
