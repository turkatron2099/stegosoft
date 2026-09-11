// Month-view calendar with per-day events, saved in localStorage (this is a
// static site with no backend, so "saved" means "saved in this browser").
// Dates are keyed as local "YYYY-MM-DD" strings throughout — never a raw
// Date object or ISO/UTC string — so a day's key can't drift across a
// timezone/DST boundary.
(() => {
  const STORAGE_KEY = "thagobyteCalendarEvents";

  const monthYearEl = document.getElementById("calendar-month-year");
  const gridEl = document.getElementById("calendar-grid");
  const prevBtn = document.getElementById("calendar-prev");
  const nextBtn = document.getElementById("calendar-next");
  const todayBtn = document.getElementById("calendar-today");
  const agendaTitle = document.getElementById("calendar-agenda-title");
  const eventListEl = document.getElementById("calendar-event-list");
  const addForm = document.getElementById("calendar-add-form");
  const addInput = document.getElementById("calendar-add-input");

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11
  let selectedKey = dateKey(today);

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveEvents(events) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch (e) {
      // Storage unavailable (private browsing, full quota) — edits just
      // won't persist past this page view.
    }
  }

  let events = loadEvents();

  function renderGrid() {
    monthYearEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    gridEl.innerHTML = "";

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

    const todayKey = dateKey(today);

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startWeekday + 1;
      let cellDate, isOutside;
      if (dayNum < 1) {
        cellDate = new Date(viewYear, viewMonth - 1, daysInPrevMonth + dayNum);
        isOutside = true;
      } else if (dayNum > daysInMonth) {
        cellDate = new Date(viewYear, viewMonth + 1, dayNum - daysInMonth);
        isOutside = true;
      } else {
        cellDate = new Date(viewYear, viewMonth, dayNum);
        isOutside = false;
      }
      const key = dateKey(cellDate);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-day";
      if (isOutside) cell.classList.add("is-outside");
      if (key === todayKey) cell.classList.add("is-today");
      if (key === selectedKey) cell.classList.add("is-selected");
      cell.setAttribute(
        "aria-label",
        `${WEEKDAY_NAMES[cellDate.getDay()]}, ${MONTH_NAMES[cellDate.getMonth()]} ${cellDate.getDate()}, ${cellDate.getFullYear()}`
      );

      const numEl = document.createElement("span");
      numEl.className = "calendar-day-number";
      numEl.textContent = cellDate.getDate();
      cell.appendChild(numEl);

      if (events[key] && events[key].length) {
        const dot = document.createElement("span");
        dot.className = "calendar-day-dot";
        cell.appendChild(dot);
      }

      cell.addEventListener("click", () => {
        selectedKey = key;
        if (isOutside) {
          viewYear = cellDate.getFullYear();
          viewMonth = cellDate.getMonth();
        }
        renderGrid();
        renderAgenda();
      });

      gridEl.appendChild(cell);
    }
  }

  function renderAgenda() {
    const [y, m, d] = selectedKey.split("-").map(Number);
    const selDate = new Date(y, m - 1, d);
    agendaTitle.textContent = `${WEEKDAY_NAMES[selDate.getDay()]}, ${MONTH_NAMES[selDate.getMonth()]} ${selDate.getDate()}`;

    eventListEl.innerHTML = "";
    const dayEvents = events[selectedKey] || [];
    dayEvents.forEach((ev) => {
      const li = document.createElement("li");
      li.className = "calendar-event-item";

      const textEl = document.createElement("span");
      textEl.className = "calendar-event-text";
      textEl.textContent = ev.text;
      li.appendChild(textEl);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "calendar-event-remove";
      removeBtn.setAttribute("aria-label", `Remove "${ev.text}"`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        events[selectedKey] = (events[selectedKey] || []).filter((e) => e.id !== ev.id);
        if (events[selectedKey].length === 0) delete events[selectedKey];
        saveEvents(events);
        renderGrid();
        renderAgenda();
      });
      li.appendChild(removeBtn);

      eventListEl.appendChild(li);
    });
  }

  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    renderGrid();
  }

  prevBtn.addEventListener("click", () => changeMonth(-1));
  nextBtn.addEventListener("click", () => changeMonth(1));
  todayBtn.addEventListener("click", () => {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    selectedKey = dateKey(today);
    renderGrid();
    renderAgenda();
  });

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = addInput.value.trim();
    if (!text) return;
    if (!events[selectedKey]) events[selectedKey] = [];
    events[selectedKey].push({ id: Date.now() + Math.random().toString(36).slice(2), text });
    saveEvents(events);
    addInput.value = "";
    renderGrid();
    renderAgenda();
  });

  renderGrid();
  renderAgenda();
})();

// Timezone converter. Pure Intl.DateTimeFormat — no library, no API call.
// Converting a naive "wall-clock" datetime-local value into a real instant
// for an arbitrary IANA zone (correctly, across DST) isn't something Intl
// exposes directly, so zonedTimeToUtc uses the standard trick: read the
// input's digits as if they were UTC to get a reference instant, then
// compare how that SAME instant's clock face reads in the target zone vs.
// UTC — the difference is exactly that zone's offset at that moment
// (DST-correct, since Intl resolves it for the real date) — and shifting
// the reference instant by that difference lands on the true UTC instant
// for the original wall-clock reading.
(() => {
  const datetimeInput = document.getElementById("tc-datetime");
  const nowBtn = document.getElementById("tc-now");
  const fromSelect = document.getElementById("tc-from");
  const toSelect = document.getElementById("tc-to");
  const swapBtn = document.getElementById("tc-swap");
  const resultEl = document.getElementById("tc-result");

  const FALLBACK_ZONES = [
    "UTC", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
    "America/Chicago", "America/New_York", "America/Sao_Paulo", "Atlantic/Azores",
    "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "Africa/Cairo",
    "Africa/Johannesburg", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka",
    "Asia/Bangkok", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney",
    "Pacific/Auckland",
  ];

  function getZoneList() {
    try {
      const zones = Intl.supportedValuesOf("timeZone");
      if (zones && zones.length) return zones;
    } catch (e) {
      // Older browser without Intl.supportedValuesOf — use the fallback list.
    }
    return FALLBACK_ZONES;
  }

  function zoneLabel(zone) {
    return zone.replace(/_/g, " ").replace(/\//g, " / ");
  }

  function populateSelect(select, zones, defaultZone) {
    zones.forEach((zone) => {
      const opt = document.createElement("option");
      opt.value = zone;
      opt.textContent = zoneLabel(zone);
      select.appendChild(opt);
    });
    if (zones.includes(defaultZone)) select.value = defaultZone;
  }

  function toDatetimeLocalValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // The offset (ms) between how `date` reads in `zone` vs. how it reads in
  // UTC — i.e. zone's real UTC offset at that instant.
  function offsetMsAt(date, zone) {
    const zoned = new Date(date.toLocaleString("en-US", { timeZone: zone }));
    const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    return utc.getTime() - zoned.getTime();
  }

  function zonedTimeToUtc(datetimeLocalStr, zone) {
    const naiveAsUtc = new Date(datetimeLocalStr + "Z");
    const offset = offsetMsAt(naiveAsUtc, zone);
    return new Date(naiveAsUtc.getTime() + offset);
  }

  function formatOffset(ms) {
    const totalMinutes = Math.round(ms / 60000);
    const sign = totalMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(totalMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
  }

  function render() {
    if (!datetimeInput.value) return;
    const fromZone = fromSelect.value;
    const toZone = toSelect.value;
    if (!fromZone || !toZone) return;

    let utcInstant;
    try {
      utcInstant = zonedTimeToUtc(datetimeInput.value, fromZone);
    } catch (e) {
      resultEl.textContent = "Couldn't convert that date/time.";
      return;
    }

    const timeText = new Intl.DateTimeFormat("en-US", {
      timeZone: toZone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(utcInstant);

    const fromOffset = -offsetMsAt(utcInstant, fromZone);
    const toOffset = -offsetMsAt(utcInstant, toZone);

    resultEl.innerHTML = "";
    const timeEl = document.createElement("div");
    timeEl.className = "tc-result-time";
    timeEl.textContent = timeText;
    resultEl.appendChild(timeEl);

    const zoneEl = document.createElement("div");
    zoneEl.className = "tc-result-zone";
    zoneEl.textContent = zoneLabel(toZone);
    resultEl.appendChild(zoneEl);

    const offsetEl = document.createElement("div");
    offsetEl.className = "tc-result-offset";
    offsetEl.textContent = `${zoneLabel(fromZone)} is ${formatOffset(fromOffset)}, ${zoneLabel(toZone)} is ${formatOffset(toOffset)}`;
    resultEl.appendChild(offsetEl);
  }

  // "UTC" is always a valid Intl timeZone identifier even on browsers whose
  // supportedValuesOf("timeZone") enumeration omits it (seen in the wild) —
  // guarantee it's selectable, and pin it first rather than wherever it'd
  // fall alphabetically, since it's the most common reference zone.
  const zones = ["UTC", ...getZoneList().filter((z) => z !== "UTC").sort()];
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  populateSelect(fromSelect, zones, localZone);
  populateSelect(toSelect, zones, "UTC");
  datetimeInput.value = toDatetimeLocalValue(new Date());

  nowBtn.addEventListener("click", () => {
    datetimeInput.value = toDatetimeLocalValue(new Date());
    render();
  });
  swapBtn.addEventListener("click", () => {
    const tmp = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = tmp;
    render();
  });
  datetimeInput.addEventListener("input", render);
  fromSelect.addEventListener("change", render);
  toSelect.addEventListener("change", render);

  render();
})();
