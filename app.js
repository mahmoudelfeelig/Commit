const WIDTH = 53;
const HEIGHT = 7;
const MAX_LEVEL = 4;
const STORAGE_KEY = "imprint-state-v1";

const colors = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const els = {
  yearList: document.getElementById("year-list"),
  singleYear: document.getElementById("single-year"),
  rangeStart: document.getElementById("range-start"),
  rangeEnd: document.getElementById("range-end"),
  addYear: document.getElementById("add-year"),
  addRange: document.getElementById("add-range"),
  clearAll: document.getElementById("clear-all"),
  clearYear: document.getElementById("clear-year"),
  prevYear: document.getElementById("prev-year"),
  nextYear: document.getElementById("next-year"),
  currentYear: document.getElementById("current-year"),
  brushGroup: document.getElementById("brush-group"),
  summary: document.getElementById("summary"),
  command: document.getElementById("command"),
  copyCommand: document.getElementById("copy-command"),
  canvas: document.getElementById("graph-canvas"),
};

function utcDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

function sundayOnOrBefore(date) {
  const day = date.getUTCDay();
  return new Date(date.getTime() - day * 24 * 60 * 60 * 1000);
}

function allDatesForYearGrid(year) {
  const start = sundayOnOrBefore(utcDate(year, 0, 1));
  const grid = Array.from({ length: WIDTH }, (_, x) =>
    Array.from({ length: HEIGHT }, (_, y) => new Date(start.getTime() + (7 * x + y) * 24 * 60 * 60 * 1000))
  );
  return grid;
}

function emptyLevels() {
  return Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(0));
}

function encodeShape(levels) {
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    rows.push(levels[y].map((v) => Math.max(0, Math.min(MAX_LEVEL, Number(v) || 0))).join(""));
  }
  return btoa(rows.join("\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sanitizeShape(levels) {
  const out = emptyLevels();
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      out[y][x] = Math.max(0, Math.min(MAX_LEVEL, Number(levels?.[y]?.[x]) || 0));
    }
  }
  return out;
}

function computeCommitScheduleFromLevels(levels, year) {
  const cal = allDatesForYearGrid(year);
  const selected = [];
  for (let x = 0; x < WIDTH; x += 1) {
    for (let y = 0; y < HEIGHT; y += 1) {
      const level = Number(levels[y][x]) || 0;
      if (level <= 0) continue;
      const d = cal[x][y];
      if (d.getUTCFullYear() !== year) continue;
      const ts = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
      for (let i = 0; i < Math.min(level, MAX_LEVEL); i += 1) {
        selected.push(ts);
      }
    }
  }
  selected.sort((a, b) => a - b);
  return selected;
}

function defaultYears() {
  const now = new Date();
  const current = now.getUTCFullYear();
  return [current - 2, current - 1, current];
}

function loadState() {
  const defaultsYears = defaultYears();
  const defaults = {
    years: defaultsYears,
    currentYear: defaultsYears[2],
    brushLevel: MAX_LEVEL,
    rangeStart: defaultsYears[0],
    rangeEnd: defaultsYears[2],
    shapes: {},
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const years = Array.isArray(parsed.years) && parsed.years.length ? parsed.years.map((y) => Number(y)).filter(Number.isFinite) : defaults.years;
    const shapes = {};
    for (const year of years) {
      shapes[year] = sanitizeShape(parsed.shapes?.[year] || emptyLevels());
    }
    return {
      years: Array.from(new Set(years)).sort((a, b) => a - b),
      currentYear: Number(parsed.currentYear) || defaults.currentYear,
      brushLevel: Number.isFinite(Number(parsed.brushLevel)) ? Number(parsed.brushLevel) : defaults.brushLevel,
      rangeStart: Number(parsed.rangeStart) || defaults.rangeStart,
      rangeEnd: Number(parsed.rangeEnd) || defaults.rangeEnd,
      shapes,
    };
  } catch {
    return defaults;
  }
}

let state = loadState();
if (!state.years.length) {
  state.years = defaultYears();
}
if (!state.shapes[state.currentYear]) {
  state.currentYear = state.years[state.years.length - 1];
}
for (const year of state.years) {
  state.shapes[year] = sanitizeShape(state.shapes[year] || emptyLevels());
}

const ctx = els.canvas.getContext("2d");
const dpr = window.devicePixelRatio || 1;
const cell = 14;
const gap = 3;
const marginX = 32;
const marginY = 22;
const canvasWidth = marginX + WIDTH * (cell + gap) - gap + 10;
const canvasHeight = marginY + HEIGHT * (cell + gap) - gap + 10;

els.canvas.style.width = `${canvasWidth}px`;
els.canvas.style.height = `${canvasHeight}px`;
els.canvas.width = Math.round(canvasWidth * dpr);
els.canvas.height = Math.round(canvasHeight * dpr);
ctx.scale(dpr, dpr);

function saveState() {
  const payload = {
    years: state.years,
    currentYear: state.currentYear,
    brushLevel: state.brushLevel,
    rangeStart: state.rangeStart,
    rangeEnd: state.rangeEnd,
    shapes: state.shapes,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function yearShape(year) {
  if (!state.shapes[year]) {
    state.shapes[year] = emptyLevels();
  }
  return state.shapes[year];
}

function ensureYear(year, select = true, quiet = false) {
  if (!Number.isFinite(year) || year < 1970 || year > 9999) {
    return false;
  }
  if (!state.years.includes(year)) {
    state.years.push(year);
    state.years.sort((a, b) => a - b);
  }
  yearShape(year);
  if (select) {
    state.currentYear = year;
  }
  if (!quiet) {
    syncYearControls();
    render();
    saveState();
  }
  return true;
}

function removeYear(year) {
  if (state.years.length === 1) {
    return;
  }
  state.years = state.years.filter((item) => item !== year);
  delete state.shapes[year];
  if (!state.years.includes(state.currentYear)) {
    state.currentYear = state.years[state.years.length - 1];
  }
  render();
  saveState();
}

function syncYearControls() {
  els.singleYear.value = String(state.currentYear + 1);
  els.rangeStart.value = String(state.rangeStart);
  els.rangeEnd.value = String(state.rangeEnd);

  els.currentYear.innerHTML = "";
  for (const year of state.years) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    els.currentYear.appendChild(option);
  }
  els.currentYear.value = String(state.currentYear);

  els.yearList.innerHTML = "";
  for (const year of state.years) {
    const row = document.createElement("div");
    row.className = "year-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = `year-button${year === state.currentYear ? " active" : ""}`;
    button.textContent = String(year);
    button.addEventListener("click", () => {
      state.currentYear = year;
      syncYearControls();
      render();
      saveState();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "year-remove";
    remove.textContent = "Remove";
    remove.disabled = state.years.length === 1;
    remove.addEventListener("click", () => removeYear(year));

    row.appendChild(button);
    row.appendChild(remove);
    els.yearList.appendChild(row);
  }

  els.brushGroup.innerHTML = "";
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `brush-button${level === state.brushLevel ? " active" : ""}`;
    button.textContent = String(level);
    button.addEventListener("click", () => {
      state.brushLevel = level;
      syncYearControls();
      render();
      saveState();
    });
    els.brushGroup.appendChild(button);
  }
}

function refreshSummaryAndCommand() {
  const lines = [];
  let total = 0;
  const parts = [];

  for (const year of state.years) {
    const levels = yearShape(year);
    const count = computeCommitScheduleFromLevels(levels, year).length;
    total += count;
    lines.push(`${year}: ${count} commits`);
    if (levels.some((row) => row.some((value) => value > 0))) {
      parts.push(`--shape ${year}:${encodeShape(levels)}`);
    }
  }

  lines.push(`Total: ${total} commits`);
  els.summary.textContent = lines.join("\n");
  els.command.value = parts.length ? `python3 main.py \\\n  ${parts.join(" \\\n  ")}` : "Draw cells to generate a command.";
}

function drawGrid() {
  const year = state.currentYear;
  const cal = allDatesForYearGrid(year);
  const levels = yearShape(year);

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#24292f";
  ctx.font = "bold 13px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(String(year), 8, 18);

  ctx.fillStyle = "#57606a";
  ctx.font = "12px Inter, ui-sans-serif, system-ui, sans-serif";
  for (let y = 0; y < HEIGHT; y += 1) {
    ctx.fillText(weekdayLabels[y][0], 4, marginY + y * (cell + gap) + 10);
  }

  for (let x = 0; x < WIDTH; x += 1) {
    for (let y = 0; y < HEIGHT; y += 1) {
      const left = marginX + x * (cell + gap);
      const top = marginY + y * (cell + gap);
      const outside = cal[x][y].getUTCFullYear() !== year;
      const fill = outside ? "#f6f8fa" : colors[levels[y][x]];
      ctx.fillStyle = fill;
      ctx.strokeStyle = outside ? "#eaeef2" : "#d0d7de";
      ctx.lineWidth = 1;
      ctx.fillRect(left, top, cell, cell);
      ctx.strokeRect(left + 0.5, top + 0.5, cell - 1, cell - 1);
    }
  }
}

function render() {
  syncYearControls();
  drawGrid();
  refreshSummaryAndCommand();
}

function paintAt(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left - marginX) / (cell + gap));
  const y = Math.floor((event.clientY - rect.top - marginY) / (cell + gap));
  const grid = allDatesForYearGrid(state.currentYear);
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  if (grid[x][y].getUTCFullYear() !== state.currentYear) return;
  yearShape(state.currentYear)[y][x] = state.brushLevel;
  render();
  saveState();
}

let isPainting = false;
els.canvas.addEventListener("pointerdown", (event) => {
  isPainting = true;
  els.canvas.setPointerCapture(event.pointerId);
  paintAt(event);
});
els.canvas.addEventListener("pointermove", (event) => {
  if (!isPainting) return;
  paintAt(event);
});
els.canvas.addEventListener("pointerup", () => {
  isPainting = false;
});
els.canvas.addEventListener("pointerleave", () => {
  isPainting = false;
});

els.singleYear.value = String(state.currentYear + 1);
els.rangeStart.value = String(state.rangeStart);
els.rangeEnd.value = String(state.rangeEnd);

els.currentYear.addEventListener("change", () => {
  state.currentYear = Number(els.currentYear.value);
  render();
  saveState();
});

els.addYear.addEventListener("click", () => {
  const year = Number(els.singleYear.value);
  if (ensureYear(year)) {
    state.currentYear = year;
    render();
    saveState();
  }
});

els.addRange.addEventListener("click", () => {
  let start = Number(els.rangeStart.value);
  let end = Number(els.rangeEnd.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  if (start > end) [start, end] = [end, start];
  state.rangeStart = start;
  state.rangeEnd = end;
  for (let year = start; year <= end; year += 1) {
    ensureYear(year, false, true);
  }
  state.currentYear = end;
  render();
  saveState();
});

els.prevYear.addEventListener("click", () => {
  const idx = state.years.indexOf(state.currentYear);
  if (idx > 0) {
    state.currentYear = state.years[idx - 1];
    render();
    saveState();
  }
});

els.nextYear.addEventListener("click", () => {
  const idx = state.years.indexOf(state.currentYear);
  if (idx >= 0 && idx < state.years.length - 1) {
    state.currentYear = state.years[idx + 1];
    render();
    saveState();
  }
});

els.clearYear.addEventListener("click", () => {
  state.shapes[state.currentYear] = emptyLevels();
  render();
  saveState();
});

els.clearAll.addEventListener("click", () => {
  state.shapes = {};
  state.years = [state.currentYear];
  state.shapes[state.currentYear] = emptyLevels();
  render();
  saveState();
});

els.copyCommand.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.command.value);
  } catch {
    els.command.focus();
    els.command.select();
    document.execCommand("copy");
  }
});

window.addEventListener("beforeunload", saveState);

syncYearControls();
render();
