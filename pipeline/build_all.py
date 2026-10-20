"""Runs the whole sprite pipeline: simulate → pick a stride → render → align → build the sheet.

  OUT/sim/       render_walk.py --poses-only (thorax pose and tarsus tips at every 0.1 ms step)
  OUT/cycle.json extract_cycle.py
  OUT/frames/    render_walk.py --plan (16 walk frames, 2 idle frames, label maps)
  OUT/aligned/   align_frames.py
  OUT/sheet/     build_sheet.py: fly-sheet.png, fly-sheet.webp, fly-sheet.json

With --dist the three sheet files are copied to dist/. The pipeline is deterministic: running it
twice gives byte-identical JSON and pixel-identical sheets (pipeline test 7).

Usage: python pipeline/build_all.py OUT [--dist] [--frames 16] [--body-length 96] [--colors 64]
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIST = HERE.parent / "dist"
SHEET_FILES = ("fly-sheet.png", "fly-sheet.webp", "fly-sheet.json")


def run(*args):
    subprocess.run([sys.executable, *map(str, args)], check=True, stdout=subprocess.DEVNULL)


def build_all(out, frames=16, body_length=96, colors=64):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    run(HERE / "render_walk.py", out / "sim", "--poses-only")
    run(HERE / "extract_cycle.py", out / "sim", out / "cycle.json", "--frames", frames)
    run(HERE / "render_walk.py", out / "frames", "--plan", out / "cycle.json")
    run(HERE / "align_frames.py", out / "frames", out / "aligned")
    run(HERE / "build_sheet.py", out / "aligned", out / "cycle.json", out / "sheet",
        "--body-length", body_length, "--colors", colors)
    return out / "sheet"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", type=Path)
    ap.add_argument("--dist", action="store_true", help="copy the sheet files to dist/")
    ap.add_argument("--frames", type=int, default=16)
    ap.add_argument("--body-length", type=int, default=96)
    ap.add_argument("--colors", type=int, default=64)
    args = ap.parse_args()
    sheet = build_all(args.out, args.frames, args.body_length, args.colors)
    if args.dist:
        for name in SHEET_FILES:
            shutil.copyfile(sheet / name, DIST / name)
    meta = json.loads((sheet / "fly-sheet.json").read_text())
    sizes = {n: (sheet / n).stat().st_size for n in SHEET_FILES}
    print(json.dumps({"frame": [meta["frameWidth"], meta["frameHeight"]], "anchor": meta["anchor"],
                      "strideBL": meta["clips"]["walk"]["strideBL"], "bytes": sizes,
                      "copiedToDist": args.dist}, indent=1))


if __name__ == "__main__":
    main()
