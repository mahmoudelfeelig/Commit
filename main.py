#!/usr/bin/env python3
"""GitHub contribution graph writer with a small shape designer."""

import argparse
import base64
import subprocess
import sys
import os
import zlib
from datetime import date, datetime, timedelta, timezone

def sunday_on_or_before(d: date) -> date:
    return d - timedelta(days=(d.weekday() + 1) % 7)

def all_dates_for_year_grid(year: int):
    """Return a 53x7 matrix of dates covering a GitHub-style year grid."""
    start = sunday_on_or_before(date(year, 1, 1))
    grid = [[start + timedelta(days=7*x + y) for y in range(7)] for x in range(53)]
    return grid

WIDTH = 53
HEIGHT = 7
MAX_LEVEL = 4


def empty_levels():
    return [[0] * WIDTH for _ in range(HEIGHT)]


def rasterize_text_to_53x7(text: str) -> list:
    """
    Render text using Pillow, then scale to 53x7 and binarize.
    Returns a 7x53 level grid [y][x] where 0 means empty and 4 means darkest.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception as exc:
        raise SystemExit("Text mode needs Pillow. Install with: pip install pillow") from exc

    font = ImageFont.load_default()
    tmp = Image.new("L", (1200, 200), 0)
    drw = ImageDraw.Draw(tmp)
    drw.text((0, 0), text, fill=255, font=font)
    bbox = tmp.getbbox()
    if not bbox:
        return empty_levels()
    cropped = tmp.crop(bbox)

    small = cropped.resize((53, 7), Image.NEAREST)

    data = small.load()
    out = [[MAX_LEVEL if data[x, y] else 0 for x in range(WIDTH)] for y in range(HEIGHT)]
    return out

def encode_shape(levels: list) -> str:
    """
    Encode a 7x53 grid of contribution levels (0..4) into a shell-safe token
    that can be passed to --shape YEAR:TOKEN.
    """
    rows = []
    for y in range(HEIGHT):
        if len(levels[y]) != WIDTH:
            raise ValueError("shape rows must be 53 cells wide")
        rows.append("".join(str(max(0, min(MAX_LEVEL, int(v)))) for v in levels[y]))
    raw = "\n".join(rows).encode("ascii")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_shape(token: str) -> list:
    padding = "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(token + padding)
    except Exception as exc:
        raise ValueError("shape token is not valid") from exc

    try:
        raw = zlib.decompress(decoded).decode("ascii")
    except Exception:
        try:
            raw = decoded.decode("ascii")
        except Exception as exc:
            raise ValueError("shape token is not valid") from exc

    rows = raw.splitlines()
    if len(rows) != HEIGHT or any(len(row) != WIDTH for row in rows):
        raise ValueError("shape token must decode to a 7x53 grid")

    levels = empty_levels()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in "01234":
                raise ValueError("shape cells must be contribution levels 0..4")
            levels[y][x] = int(ch)
    return levels


def shape_from_text(word: str):
    return rasterize_text_to_53x7(word)


def compute_commit_schedule_from_levels(levels: list, year: int):
    """Combine the raster grid with the calendar grid for one year."""
    cal = all_dates_for_year_grid(year)

    selected = []
    for x in range(WIDTH):
        for y in range(HEIGHT):
            level = int(levels[y][x])
            if level <= 0:
                continue
            d = cal[x][y]
            if d.year != year:
                continue
            ts = datetime(d.year, d.month, d.day, 12, 0, 0)
            selected.extend([ts] * min(level, MAX_LEVEL))

    selected.sort()
    return selected


def compute_commit_schedule(word: str, year: int):
    return compute_commit_schedule_from_levels(shape_from_text(word), year)

def shell_quote(value: str) -> str:
    return "'" + str(value).replace("'", "'\"'\"'") + "'"

def format_stamp(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%d %H:%M:%S +0000")

def build_git_command_from_shapes(shapes: dict, years: list) -> str:
    lines = ["# Run this from the root of the git repository you want to update.", "set -e"]
    for year in sorted(years):
        per_day = {}
        schedule = compute_commit_schedule_from_levels(shapes[year], year)
        for ts in schedule:
            stamp = format_stamp(ts)
            day = ts.date().isoformat()
            per_day[day] = per_day.get(day, 0) + 1
            msg = f"[imprint] {year} {day} #{per_day[day]}"
            lines.append(
                f"GIT_AUTHOR_DATE={shell_quote(stamp)} GIT_COMMITTER_DATE={shell_quote(stamp)} "
                f"git commit --allow-empty -m {shell_quote(msg)} --quiet"
            )
    if len(lines) == 2:
        return "# Draw some cells first, then copy the git command."
    return "\n".join(lines)


def run(cmd, env=None):
    res = subprocess.run(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if res.returncode != 0:
        sys.stderr.write(res.stdout)
        raise SystemExit(res.returncode)
    return res.stdout


def launch_designer():
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except Exception as exc:
        raise SystemExit(f"Could not open designer because tkinter is unavailable: {exc}")

    now = datetime.now(timezone.utc)
    years = [now.year - 2, now.year - 1, now.year]
    shapes = {year: empty_levels() for year in years}
    cell = 14
    gap = 3
    margin_x = 32
    margin_y = 22
    colors = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"]
    weekday_labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    root = tk.Tk()
    root.title("Contribution Graph Designer")
    root.resizable(True, True)
    root.minsize(1200, 760)

    current_year = tk.IntVar(master=root, value=years[-1])
    year_to_add = tk.StringVar(master=root, value=str(now.year + 1))
    range_start = tk.StringVar(master=root, value=str(now.year - 4))
    range_end = tk.StringVar(master=root, value=str(now.year))
    brush_level = tk.IntVar(master=root, value=MAX_LEVEL)

    def ensure_year(year: int, *, select: bool = True):
        if year not in shapes:
            shapes[year] = empty_levels()
            years.append(year)
            years.sort()
            refresh_year_list()
        if select:
            current_year.set(year)
            year_list.selection_clear(0, "end")
            idx = years.index(year)
            year_list.selection_set(idx)
            year_list.see(idx)

    def set_current_year_from_selection(_event=None):
        sel = year_list.curselection()
        if not sel:
            return
        current_year.set(years[sel[0]])
        draw_grid()
        refresh_summary()
        refresh_command()

    def current_year_value():
        return int(current_year.get())

    def refresh_year_list():
        year_box.configure(values=years)
        year_list.delete(0, "end")
        for yr in years:
            year_list.insert("end", str(yr))
        if years:
            selected = current_year_value()
            if selected in years:
                idx = years.index(selected)
                year_list.selection_set(idx)
                year_list.see(idx)

    canvas_w = margin_x + WIDTH * (cell + gap) - gap + 10
    canvas_h = margin_y + HEIGHT * (cell + gap) - gap + 10

    root.columnconfigure(1, weight=1)
    root.rowconfigure(1, weight=1)

    sidebar = ttk.Frame(root, padding=(10, 10, 8, 10))
    sidebar.grid(row=0, column=0, rowspan=3, sticky="ns")
    sidebar.rowconfigure(1, weight=1)

    editor = ttk.Frame(root, padding=(0, 10, 10, 10))
    editor.grid(row=0, column=1, rowspan=3, sticky="nsew")
    editor.columnconfigure(0, weight=1)
    editor.rowconfigure(1, weight=1)

    ttk.Label(sidebar, text="Years").grid(row=0, column=0, sticky="w")
    year_list_frame = ttk.Frame(sidebar)
    year_list_frame.grid(row=1, column=0, sticky="nsew", pady=(6, 8))
    year_list_scroll = ttk.Scrollbar(year_list_frame, orient="vertical")
    year_list = tk.Listbox(
        year_list_frame,
        height=16,
        exportselection=False,
        activestyle="none",
        yscrollcommand=year_list_scroll.set,
    )
    year_list_scroll.config(command=year_list.yview)
    year_list.pack(side="left", fill="both", expand=True)
    year_list_scroll.pack(side="right", fill="y")
    year_list.bind("<<ListboxSelect>>", set_current_year_from_selection)

    year_controls = ttk.Frame(sidebar)
    year_controls.grid(row=2, column=0, sticky="nsew")
    year_controls.columnconfigure(0, weight=1)
    year_controls.columnconfigure(1, weight=1)
    year_controls.columnconfigure(2, weight=1)
    ttk.Label(year_controls, text="Add year").grid(row=0, column=0, columnspan=3, sticky="w")
    ttk.Entry(year_controls, textvariable=year_to_add, width=10).grid(row=1, column=0, sticky="ew", pady=(4, 6))
    ttk.Button(year_controls, text="Add", command=lambda: add_year()).grid(row=1, column=1, sticky="ew", padx=(6, 0), pady=(4, 6))
    ttk.Button(year_controls, text="Remove", command=lambda: remove_year()).grid(row=1, column=2, sticky="ew", padx=(6, 0), pady=(4, 6))
    ttk.Label(year_controls, text="Add range").grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 0))
    ttk.Entry(year_controls, textvariable=range_start, width=10).grid(row=3, column=0, sticky="ew", pady=(4, 6))
    ttk.Entry(year_controls, textvariable=range_end, width=10).grid(row=3, column=1, sticky="ew", padx=(6, 0), pady=(4, 6))
    ttk.Button(year_controls, text="Load", command=lambda: add_year_range()).grid(row=3, column=2, sticky="ew", padx=(6, 0), pady=(4, 6))

    top = ttk.Frame(editor)
    top.grid(row=0, column=0, sticky="ew", padx=(0, 0), pady=(0, 8))
    top.columnconfigure(7, weight=1)
    ttk.Button(top, text="Prev", command=lambda: select_adjacent_year(-1)).grid(row=0, column=0, padx=(0, 6))
    ttk.Button(top, text="Next", command=lambda: select_adjacent_year(1)).grid(row=0, column=1, padx=(0, 12))
    ttk.Label(top, text="Selected year").grid(row=0, column=2, padx=(0, 6))
    year_box = ttk.Combobox(top, values=years, textvariable=current_year, width=10, state="readonly")
    year_box.grid(row=0, column=3, padx=(0, 12))
    ttk.Label(top, text="Brush").grid(row=0, column=4, padx=(0, 6))
    for level in range(MAX_LEVEL + 1):
        rb = ttk.Radiobutton(top, text=str(level), value=level, variable=brush_level)
        rb.grid(row=0, column=5 + level, padx=2)

    canvas = tk.Canvas(editor, width=canvas_w, height=canvas_h, bg="white", highlightthickness=0)
    canvas.grid(row=1, column=0, sticky="nsew")

    summary_text = tk.Text(editor, width=112, height=4, wrap="word")
    summary_text.grid(row=2, column=0, sticky="ew", pady=(10, 8))
    summary_text.configure(state="disabled")

    command_text = tk.Text(editor, width=112, height=7, wrap="word")
    command_text.grid(row=3, column=0, sticky="ew")

    def year():
        return current_year_value()

    def draw_grid():
        canvas.delete("all")
        yr = year()
        cal = all_dates_for_year_grid(yr)
        canvas.create_text(8, 8, text=f"{yr}", anchor="nw", fill="#24292f", font=("TkDefaultFont", 13, "bold"))
        for y, label in enumerate(weekday_labels):
            canvas.create_text(4, margin_y + y * (cell + gap) + cell / 2, text=label[:1], anchor="w", fill="#57606a")
        levels = shapes[yr]
        for x in range(WIDTH):
            for y in range(HEIGHT):
                left = margin_x + x * (cell + gap)
                top_y = margin_y + y * (cell + gap)
                outside_year = cal[x][y].year != yr
                fill = "#f6f8fa" if outside_year else colors[levels[y][x]]
                canvas.create_rectangle(
                    left,
                    top_y,
                    left + cell,
                    top_y + cell,
                    fill=fill,
                    outline="#eaeef2" if outside_year else "#d0d7de",
                    width=1,
                    tags=(f"cell-{x}-{y}", "cell"),
                )

    def refresh_summary():
        lines = []
        total = 0
        for yr in years:
            levels = shapes.get(yr, empty_levels())
            schedule = compute_commit_schedule_from_levels(levels, yr)
            count = len(schedule)
            total += count
            lines.append(f"{yr}: {count} commits")
        lines.append(f"Total: {total} commits")
        summary_text.configure(state="normal")
        summary_text.delete("1.0", "end")
        summary_text.insert("1.0", "\n".join(lines))
        summary_text.configure(state="disabled")

    def refresh_command():
        cmd = build_git_command_from_shapes(shapes, years)
        command_text.delete("1.0", "end")
        command_text.insert("1.0", cmd)

    def paint_at(event):
        x = (event.x - margin_x) // (cell + gap)
        y = (event.y - margin_y) // (cell + gap)
        yr = year()
        if 0 <= x < WIDTH and 0 <= y < HEIGHT and all_dates_for_year_grid(yr)[x][y].year == yr:
            shapes[yr][y][x] = brush_level.get()
            draw_grid()
            refresh_summary()
            refresh_command()

    def clear_year():
        shapes[year()] = empty_levels()
        draw_grid()
        refresh_summary()
        refresh_command()

    def remove_year():
        yr = year()
        if len(shapes) == 1:
            messagebox.showinfo("Keep one year", "At least one year has to stay in the editor.")
            return
        if yr in shapes:
            del shapes[yr]
        years[:] = sorted(shapes)
        refresh_year_list()
        current_year.set(years[-1])
        draw_grid()
        refresh_summary()
        refresh_command()

    def add_year():
        try:
            new_year = int(year_to_add.get())
        except ValueError:
            messagebox.showerror("Invalid year", "Enter a numeric year.")
            return
        if new_year < 1970 or new_year > 9999:
            messagebox.showerror("Invalid year", "Enter a year from 1970 through 9999.")
            return
        ensure_year(new_year)
        year_to_add.set(str(new_year + 1))
        draw_grid()
        refresh_summary()
        refresh_command()

    def add_year_range():
        try:
            start_year = int(range_start.get())
            end_year = int(range_end.get())
        except ValueError:
            messagebox.showerror("Invalid range", "Enter numeric start and end years.")
            return
        if start_year > end_year:
            start_year, end_year = end_year, start_year
        if start_year < 1970 or end_year > 9999:
            messagebox.showerror("Invalid range", "Use years between 1970 and 9999.")
            return
        for yr in range(start_year, end_year + 1):
            ensure_year(yr, select=False)
        current_year.set(end_year)
        refresh_year_list()
        draw_grid()
        refresh_summary()
        refresh_command()

    def select_adjacent_year(delta: int):
        if not years:
            return
        selected = year()
        if selected not in years:
            selected = years[-1]
        idx = years.index(selected)
        idx = max(0, min(len(years) - 1, idx + delta))
        current_year.set(years[idx])
        year_list.selection_clear(0, "end")
        year_list.selection_set(idx)
        year_list.see(idx)
        draw_grid()
        refresh_summary()
        refresh_command()

    def copy_command():
        cmd = command_text.get("1.0", "end").strip()
        if not cmd or cmd.startswith("Draw cells"):
            return
        root.clipboard_clear()
        root.clipboard_append(cmd)
        messagebox.showinfo("Copied", "Command copied to clipboard.")

    buttons = ttk.Frame(root, padding=(10, 0, 10, 10))
    buttons.grid(row=4, column=1, sticky="ew", padx=(0, 10), pady=(6, 10))
    ttk.Button(buttons, text="Clear year", command=clear_year).grid(row=0, column=0, padx=(0, 6))
    ttk.Button(buttons, text="Copy command", command=copy_command).grid(row=0, column=1, padx=(0, 6))
    ttk.Label(buttons, text="0 erases, 1-4 controls commits per day / square darkness. Pale edge cells are outside the selected year.").grid(row=0, column=2, padx=(14, 0))

    canvas.bind("<Button-1>", paint_at)
    canvas.bind("<B1-Motion>", paint_at)
    year_box.bind("<<ComboboxSelected>>", lambda _event: (refresh_year_list(), draw_grid(), refresh_summary(), refresh_command()))
    refresh_year_list()
    draw_grid()
    refresh_summary()
    refresh_command()
    root.mainloop()

def main():
    now = datetime.now(timezone.utc)
    last_full = now.year - 1
    default_map = [(last_full - 2, "LEBRON"),
                   (last_full - 1, "elephanto"),
                   (last_full,     "feel")]

    ap = argparse.ArgumentParser()
    ap.add_argument("--map", action="append",
                    help="Mapping as YEAR:WORD (e.g., 2022:HELLO). Can repeat.")
    ap.add_argument("--shape", action="append",
                    help="Custom drawn shape as YEAR:TOKEN. Use --design to create tokens.")
    ap.add_argument("--design", action="store_true",
                    help="Open a graph designer that lets you draw shapes and copy a command.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Preview commit counts without creating commits or pushing.")
    ap.add_argument("--remote", default="origin", help="Git remote name to push to.")
    ap.add_argument("--branch", default=None,
                    help="Branch to push. Defaults to current HEAD.")
    args = ap.parse_args()

    if args.design:
        launch_designer()
        return

    mappings = []
    custom_shapes = []
    if args.map:
        for m in args.map:
            try:
                yr_str, wd = m.split(":", 1)
                mappings.append((int(yr_str), wd))
            except ValueError:
                raise SystemExit(f"Bad --map value: {m}")

    if args.shape:
        for s in args.shape:
            try:
                yr_str, token = s.split(":", 1)
                custom_shapes.append((int(yr_str), decode_shape(token)))
            except ValueError as exc:
                raise SystemExit(f"Bad --shape value: {s}. {exc}")

    if not mappings and not custom_shapes:
        mappings = default_map

    try:
        run(["git", "rev-parse", "--is-inside-work-tree"])
    except SystemExit:
        sys.stderr.write("Not a git repository. Initialize one and add a remote before running.\n")
        return

    if args.branch:
        run(["git", "checkout", "-B", args.branch])

    dry_run = args.dry_run or os.environ.get("DRY_RUN") is not None

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
            run(["git", "commit", "--allow-empty", "-m", msg, "--quiet"], env=env)

    for year, levels in custom_shapes:
        schedule = compute_commit_schedule_from_levels(levels, year)
        total += len(schedule)
        if dry_run:
            print(f"[DRY-RUN] {year} custom shape: {len(schedule)} commits")
            continue

        print(f"{year} custom shape: {len(schedule)} commits")
        per_day = {}
        for idx, ts in enumerate(schedule, 1):
            iso = ts.strftime("%Y-%m-%d %H:%M:%S +0000")
            env = os.environ.copy()
            env["GIT_AUTHOR_DATE"] = iso
            env["GIT_COMMITTER_DATE"] = iso
            per_day[ts.date()] = per_day.get(ts.date(), 0) + 1
            msg = f"[contrib] custom {year} {ts.date()} #{per_day[ts.date()]}"
            run(["git", "commit", "--allow-empty", "-m", msg, "--quiet"], env=env)

    if dry_run:
        print(f"[DRY-RUN] Total would commit: {total}")
        return

    ref = "HEAD" if not args.branch else args.branch
    print(f"Pushing to '{args.remote}' {ref}")
    run(["git", "push", args.remote, ref])

if __name__ == "__main__":
    main()
