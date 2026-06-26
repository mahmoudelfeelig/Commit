const WIDTH = 53;
const HEIGHT = 7;
const MAX_LEVEL = 4;
const MIN_YEAR = 1970;
const MAX_YEAR = 9999;
const STORAGE_KEY = "commit-state-v1";
const YEAR_DENSITY_THRESHOLD = 6;

const cellColors = ["#e5e7eb", "#9fd89d", "#55c56c", "#2ea043", "#1f7a3d"];
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
  currentYearTrigger: document.getElementById("current-year-trigger"),
  currentYearLabel: document.getElementById("current-year-label"),
  currentYearMenu: document.getElementById("current-year-menu"),
  yearSelect: document.getElementById("year-select"),
  brushGroup: document.getElementById("brush-group"),
  summary: document.getElementById("summary"),
  command: document.getElementById("command"),
  copyCommand: document.getElementById("copy-command"),
  canvas: document.getElementById("graph-canvas"),
  toolbar: document.querySelector(".toolbar"),
};

const ICONS = {
  plus: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m-8 0v13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 10v6M14 10v6" />
    </svg>
  `,
  chevronLeft: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 18 9 12l6-6" />
    </svg>
  `,
  chevronRight: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  `,
  clipboard: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 5.5h6M9 3.5h6A2.5 2.5 0 0 1 17.5 6v1A2.5 2.5 0 0 1 15 9.5H9A2.5 2.5 0 0 1 6.5 7V6A2.5 2.5 0 0 1 9 3.5Z" />
      <path d="M8 6.5H6A2.5 2.5 0 0 0 3.5 9v8A2.5 2.5 0 0 0 6 19.5h12A2.5 2.5 0 0 0 20.5 17V9A2.5 2.5 0 0 0 18 6.5h-2" />
    </svg>
  `,
  calendar: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3v3M16 3v3M4.5 8.5h15" />
      <path d="M6 5.5h12A2.5 2.5 0 0 1 20.5 8v10A2.5 2.5 0 0 1 18 20.5H6A2.5 2.5 0 0 1 3.5 18V8A2.5 2.5 0 0 1 6 5.5Z" />
    </svg>
  `,
};

function setButtonContent(id, icon, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<span class="btn-icon" aria-hidden="true">${icon}</span><span class="btn-label">${label}</span>`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatStamp(ts) {
  const date = new Date(ts);
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss} +0000`;
}

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

function buildGitCommand() {
  const lines = [
    "# Run this from the root of the git repository you want to update.",
    "set -e",
  ];

  for (const year of state.years) {
    const levels = yearShape(year);
    const perDay = new Map();
    const schedule = computeCommitScheduleFromLevels(levels, year);

    for (const ts of schedule) {
      const stamp = formatStamp(ts);
      const day = stamp.slice(0, 10);
      const count = (perDay.get(day) || 0) + 1;
      perDay.set(day, count);
      const msg = `[commit] ${year} ${day} #${count}`;
      lines.push(
        `GIT_AUTHOR_DATE=${shellQuote(stamp)} GIT_COMMITTER_DATE=${shellQuote(stamp)} git commit --allow-empty -m ${shellQuote(msg)} --quiet`
      );
    }
  }

  if (lines.length === 2) {
    return "# Draw some cells first, then copy the git command.";
  }

  return lines.join("\n");
}

function defaultYears() {
  const now = new Date();
  const current = now.getUTCFullYear();
  return [current - 2, current - 1, current];
}

function clampYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  return Math.max(MIN_YEAR, Math.min(MAX_YEAR, Math.trunc(year)));
}

function clampYearInput(input) {
  const year = clampYear(input.value);
  if (year === null) return null;
  input.value = String(year);
  return year;
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
    const years = Array.isArray(parsed.years) && parsed.years.length
      ? parsed.years.map(clampYear).filter((year) => year !== null)
      : defaults.years;
    const shapes = {};
    for (const year of years) {
      shapes[year] = sanitizeShape(parsed.shapes?.[year] || emptyLevels());
    }
    const currentYear = clampYear(parsed.currentYear) || defaults.currentYear;
    return {
      years: Array.from(new Set(years)).sort((a, b) => a - b),
      currentYear,
      brushLevel: Number.isFinite(Number(parsed.brushLevel)) ? Number(parsed.brushLevel) : defaults.brushLevel,
      rangeStart: clampYear(parsed.rangeStart) || defaults.rangeStart,
      rangeEnd: clampYear(parsed.rangeEnd) || defaults.rangeEnd,
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

let isYearMenuOpen = false;

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
  const clampedYear = clampYear(year);
  if (clampedYear === null) {
    return false;
  }
  year = clampedYear;
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

  const denseYearMode = state.years.length > YEAR_DENSITY_THRESHOLD;
  els.yearSelect.classList.toggle("dense", denseYearMode);
  els.yearList.classList.toggle("compact", denseYearMode);
  els.toolbar?.classList.toggle("dense-years", denseYearMode);

  els.currentYearLabel.textContent = String(state.currentYear);
  els.currentYearTrigger.setAttribute("aria-expanded", String(isYearMenuOpen));
  els.currentYearMenu.toggleAttribute("hidden", !isYearMenuOpen);
  els.currentYearMenu.innerHTML = "";
  for (const year of state.years) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `year-select-option${year === state.currentYear ? " active" : ""}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(year === state.currentYear));
    option.textContent = String(year);
    option.addEventListener("click", () => {
      state.currentYear = year;
      closeYearMenu(true);
      syncYearControls();
      render();
      saveState();
    });
    els.currentYearMenu.appendChild(option);
  }

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
    remove.innerHTML = `<span class="btn-icon" aria-hidden="true">${ICONS.trash}</span><span class="btn-label">Remove</span>`;
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

function openYearMenu() {
  isYearMenuOpen = true;
  syncYearControls();
}

function closeYearMenu(focusTrigger = false) {
  if (!isYearMenuOpen) return;
  isYearMenuOpen = false;
  syncYearControls();
  if (focusTrigger) {
    els.currentYearTrigger.focus();
  }
}

function toggleYearMenu() {
  if (isYearMenuOpen) {
    closeYearMenu();
  } else {
    openYearMenu();
  }
}

function refreshSummaryAndCommand() {
  const lines = [];
  let total = 0;

  for (const year of state.years) {
    const levels = yearShape(year);
    const count = computeCommitScheduleFromLevels(levels, year).length;
    total += count;
    lines.push(`${year}: ${count} commits`);
  }

  lines.push(`Total: ${total} commits`);
  els.summary.textContent = lines.join("\n");
  els.command.value = buildGitCommand();
}

function drawGrid() {
  const year = state.currentYear;
  const cal = allDatesForYearGrid(year);
  const levels = yearShape(year);

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#f6f8fa";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 13px Inter Tight, Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(String(year), 8, 18);

  ctx.fillStyle = "#6b7280";
  ctx.font = "12px Inter Tight, Inter, ui-sans-serif, system-ui, sans-serif";
  for (let y = 0; y < HEIGHT; y += 1) {
    ctx.fillText(weekdayLabels[y][0], 4, marginY + y * (cell + gap) + 10);
  }

  for (let x = 0; x < WIDTH; x += 1) {
    for (let y = 0; y < HEIGHT; y += 1) {
      const left = marginX + x * (cell + gap);
      const top = marginY + y * (cell + gap);
      const outside = cal[x][y].getUTCFullYear() !== year;
      const fill = outside ? "#edf2f7" : cellColors[levels[y][x]];
      ctx.fillStyle = fill;
      ctx.strokeStyle = outside ? "#dde5ee" : "#cdd6df";
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

for (const input of [els.singleYear, els.rangeStart, els.rangeEnd]) {
  input.addEventListener("input", () => {
    clampYearInput(input);
  });
}

els.currentYearTrigger.addEventListener("click", toggleYearMenu);

els.currentYearTrigger.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openYearMenu();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeYearMenu();
  }
});

els.currentYearMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeYearMenu(true);
  }
});

els.addYear.addEventListener("click", () => {
  const year = clampYearInput(els.singleYear);
  if (ensureYear(year)) {
    state.currentYear = year;
    render();
    saveState();
  }
});

els.addRange.addEventListener("click", () => {
  let start = clampYearInput(els.rangeStart);
  let end = clampYearInput(els.rangeEnd);
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

setButtonContent("add-year", ICONS.plus, "Add");
setButtonContent("add-range", ICONS.calendar, "Load range");
setButtonContent("clear-all", ICONS.trash, "Clear all");
setButtonContent("clear-year", ICONS.trash, "Clear year");
setButtonContent("prev-year", ICONS.chevronLeft, "Prev");
setButtonContent("next-year", ICONS.chevronRight, "Next");
setButtonContent("copy-command", ICONS.clipboard, "Copy command");

document.addEventListener("pointerdown", (event) => {
  if (!isYearMenuOpen) return;
  if (els.yearSelect.contains(event.target)) return;
  closeYearMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeYearMenu();
  }
});

window.addEventListener("beforeunload", saveState);

syncYearControls();
render();
