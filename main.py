#!/usr/bin/env python3
"""
GitHub contribution "text writer" via empty commits.

What it does:
- Renders a word into a 53x7 grid (weeks x weekdays) for a given year.
- Maps lit pixels to calendar dates for that year's contribution graph.
- Creates empty commits on those dates and pushes to your remote.

Defaults:
- Draws across the last three full years:
    [year-3+1, year-2+1, year-1] => words ["LEBRON","elephanto","feel"]
  Example today (2025): years [2022, 2023, 2024]

Safety notes:
- It commits a lot. Use DRY_RUN first to preview counts.
- Commits are chronological to keep history clean.

Usage (inside your repo):
  DRY_RUN=1 python write_contrib_text.py
  python write_contrib_text.py
  # Optional custom mapping:
  python write_contrib_text.py --map 2021:HELLO --map 2022:world --remote origin

"""

import argparse
import subprocess
import sys
import os
from datetime import date, datetime, timedelta

# Pillow is used only to rasterize text cleanly. If missing, fail with a clear hint.
try:
    from PIL import Image, ImageDraw, ImageFont
except Exception as e:
    sys.stderr.write("This script needs Pillow. Install with: pip install pillow\n")
    raise

# ---------- small helpers ----------

def sunday_on_or_before(d: date) -> date:
    # Python weekday: Mon=0..Sun=6. We want the prior or same Sunday.
    return d - timedelta(days=(d.weekday() + 1) % 7)

def all_dates_for_year_grid(year: int):
    """
    Returns a 53x7 matrix of actual calendar dates covering GitHub's year grid.
    We start from the Sunday on or before Jan 1, then fill 53 weeks x 7 days.
    """
    start = sunday_on_or_before(date(year, 1, 1))
    grid = [[start + timedelta(days=7*x + y) for y in range(7)] for x in range(53)]
    return grid  # [x][y]

def rasterize_text_to_53x7(text: str) -> list:
    """
    Render text using Pillow, then scale to 53x7 and binarize.
    Returns a 7x53 boolean grid [y][x] where True means "commit here".
    """
    # Draw large to preserve shapes, then downscale cleanly.
    # The default PIL font is fine; we just need legible blobs.
    font = ImageFont.load_default()
    tmp = Image.new("L", (1200, 200), 0)
    drw = ImageDraw.Draw(tmp)
    drw.text((0, 0), text, fill=255, font=font)
    bbox = tmp.getbbox()
    if not bbox:
        return [[False]*53 for _ in range(7)]
    cropped = tmp.crop(bbox)

    # Resize to the contribution grid size: width 53, height 7
    # Use NEAREST to keep pixels crisp.
    small = cropped.resize((53, 7), Image.NEAREST)

    # Binarize: any value > 0 becomes True
    data = small.load()
    out = [[bool(data[x, y]) for x in range(53)] for y in range(7)]
    return out

def compute_commit_schedule(word: str, year: int):
    """
    Combine the raster grid with the calendar grid.
    Only keep dates that fall inside `year` to avoid bleeding into adjacent years.
    Returns a chronologically sorted list of datetime strings in UTC.
    """
    pix = rasterize_text_to_53x7(word)
    cal = all_dates_for_year_grid(year)

    selected = []
    for x in range(53):
        for y in range(7):
            if not pix[y][x]:
                continue
            d = cal[x][y]
            if d.year != year:
                continue
            # Noon UTC avoids TZ edge cases
            ts = datetime(d.year, d.month, d.day, 12, 0, 0)
            selected.append(ts)

    selected.sort()
    return selected

def run(cmd, env=None):
    res = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stdout)
        raise SystemExit(res.returncode)
    return res.stdout

# ---------- main logic ----------

def main():
    now = datetime.utcnow()
    # Choose the last three full years by default
    last_full = now.year - 1
    default_map = [(last_full - 2, "LEBRON"),
                   (last_full - 1, "elephanto"),
                   (last_full,     "feel")]

    ap = argparse.ArgumentParser()
    ap.add_argument("--map", action="append",
                    help="Mapping as YEAR:WORD (e.g., 2022:HELLO). Can repeat.")
    ap.add_argument("--remote", default="origin", help="Git remote name to push to.")
    ap.add_argument("--branch", default=None,
                    help="Branch to push. Defaults to current HEAD.")
    args = ap.parse_args()

    # Build mapping
    mappings = []
    if args.map:
        for m in args.map:
            try:
                yr_str, wd = m.split(":", 1)
                mappings.append((int(yr_str), wd))
            except ValueError:
                raise SystemExit(f"Bad --map value: {m}")
    else:
        mappings = default_map

    # Confirm we are inside a git repo
    try:
        run(["git", "rev-parse", "--is-inside-work-tree"])
    except SystemExit:
        sys.stderr.write("Not a git repository. Initialize one and add a remote before running.\n")
        return

    # Determine target ref
    if args.branch:
        run(["git", "checkout", "-B", args.branch])

    dry_run = os.environ.get("DRY_RUN") is not None

    total = 0
    for year, word in mappings:
        schedule = compute_commit_schedule(word, year)
        total += len(schedule)
        if dry_run:
            print(f"[DRY-RUN] {year} '{word}': {len(schedule)} commits")
            continue

        print(f"{year} '{word}': {len(schedule)} commits")
        for idx, ts in enumerate(schedule, 1):
            iso = ts.strftime("%Y-%m-%d %H:%M:%S +0000")
            env = os.environ.copy()
            env["GIT_AUTHOR_DATE"] = iso
            env["GIT_COMMITTER_DATE"] = iso
            msg = f"[contrib] {word} {year} {ts.date()}"
            # --allow-empty avoids file changes. --quiet keeps output terse.
            run(["git", "commit", "--allow-empty", "-m", msg, "--quiet"], env=env)

    if dry_run:
        print(f"[DRY-RUN] Total would commit: {total}")
        return

    # Push to remote
    ref = "HEAD" if not args.branch else args.branch
    print(f"Pushing to '{args.remote}' {ref}")
    run(["git", "push", args.remote, ref])

if __name__ == "__main__":
    main()
