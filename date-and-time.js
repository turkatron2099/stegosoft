// Month-view calendar — display only. This is a static site with no
// backend, so "saving" an event would only ever mean localStorage on one
// browser on one device — not worth the false promise of a real calendar,
// so this just shows the month grid with today highlighted.
(() => {
  const monthYearEl = document.getElementById("calendar-month-year");
  const gridEl = document.getElementById("calendar-grid");
  const holidaysEl = document.getElementById("calendar-holidays");
  const prevBtn = document.getElementById("calendar-prev");
  const nextBtn = document.getElementById("calendar-next");
  const todayBtn = document.getElementById("calendar-today");

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // U.S. federal holidays — a fixed, known dataset, so (unlike user events)
  // there's no "where would this even be saved" problem baking it in here.
  // Shown on the actual calendar date, not the Mon/Fri-shifted day some of
  // these get observed on when they land on a weekend.
  function nthWeekdayOfMonth(year, month, weekday, n) {
    const firstWeekday = new Date(year, month, 1).getDay();
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
    return new Date(year, month, day);
  }

  function lastWeekdayOfMonth(year, month, weekday) {
    const last = new Date(year, month + 1, 0);
    const day = last.getDate() - ((last.getDay() - weekday + 7) % 7);
    return new Date(year, month, day);
  }

  function holidaysForYear(year) {
    return [
      { name: "New Year's Day", date: new Date(year, 0, 1) },
      { name: "Martin Luther King Jr. Day", date: nthWeekdayOfMonth(year, 0, 1, 3) },
      { name: "Presidents' Day", date: nthWeekdayOfMonth(year, 1, 1, 3) },
      { name: "Memorial Day", date: lastWeekdayOfMonth(year, 4, 1) },
      { name: "Juneteenth", date: new Date(year, 5, 19) },
      { name: "Independence Day", date: new Date(year, 6, 4) },
      { name: "Labor Day", date: nthWeekdayOfMonth(year, 8, 1, 1) },
      { name: "Columbus Day", date: nthWeekdayOfMonth(year, 9, 1, 2) },
      { name: "Veterans Day", date: new Date(year, 10, 11) },
      { name: "Thanksgiving Day", date: nthWeekdayOfMonth(year, 10, 4, 4) },
      { name: "Christmas Day", date: new Date(year, 11, 25) },
    ];
  }

  // Covers the adjacent-month lead/trail days a grid can show near a year
  // boundary (e.g. a January view's last row spilling into February, or its
  // first row showing late December).
  function holidayMapFor(year) {
    const map = new Map();
    [year - 1, year, year + 1].forEach((y) => {
      holidaysForYear(y).forEach((h) => map.set(dateKey(h.date), h.name));
    });
    return map;
  }

  function renderGrid() {
    monthYearEl.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
    gridEl.innerHTML = "";
    holidaysEl.innerHTML = "";

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

    const todayKey = dateKey(today);
    const holidayMap = holidayMapFor(viewYear);
    const monthHolidays = [];

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
      const holidayName = holidayMap.get(key);
      if (holidayName && !isOutside) monthHolidays.push({ name: holidayName, date: cellDate });

      const cell = document.createElement("div");
      cell.className = "calendar-day";
      if (isOutside) cell.classList.add("is-outside");
      if (key === todayKey) cell.classList.add("is-today");
      if (holidayName) cell.classList.add("has-holiday");
      const label = `${WEEKDAY_NAMES[cellDate.getDay()]}, ${MONTH_NAMES[cellDate.getMonth()]} ${cellDate.getDate()}, ${cellDate.getFullYear()}`;
      cell.setAttribute("aria-label", holidayName ? `${label} — ${holidayName}` : label);
      if (holidayName) cell.title = holidayName;

      const numEl = document.createElement("span");
      numEl.className = "calendar-day-number";
      numEl.textContent = cellDate.getDate();
      cell.appendChild(numEl);

      if (holidayName) {
        const dot = document.createElement("span");
        dot.className = "calendar-day-holiday-dot";
        cell.appendChild(dot);
      }

      gridEl.appendChild(cell);
    }

    monthHolidays.forEach((h) => {
      const li = document.createElement("li");
      li.className = "calendar-holiday-item";

      const dateEl = document.createElement("span");
      dateEl.className = "calendar-holiday-date";
      dateEl.textContent = `${MONTH_NAMES[h.date.getMonth()].slice(0, 3)} ${h.date.getDate()}`;
      li.appendChild(dateEl);

      const nameEl = document.createElement("span");
      nameEl.className = "calendar-holiday-name";
      nameEl.textContent = h.name;
      li.appendChild(nameEl);

      holidaysEl.appendChild(li);
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
    renderGrid();
  });

  renderGrid();
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

// "What day was it?" — parses the date input's Y/M/D as plain local
// calendar components (never through a UTC-parsed string), so there's no
// chance of a timezone shift landing on the wrong weekday. Like every other
// "what day of the week" tool, this projects the modern Gregorian calendar
// backward/forward indefinitely (proleptic Gregorian) rather than
// accounting for pre-1582 calendar reform.
(() => {
  const dateInput = document.getElementById("df-date");
  const resultEl = document.getElementById("df-result");

  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function relativeLabel(diffDays) {
    if (diffDays === 0) return "Today";
    const suffix = diffDays > 0 ? "from now" : "ago";
    const abs = Math.abs(diffDays);
    if (abs < 60) return `${abs} day${abs === 1 ? "" : "s"} ${suffix}`;
    if (abs < 730) {
      const months = Math.round(abs / 30.44);
      return `${months} month${months === 1 ? "" : "s"} ${suffix}`;
    }
    const years = Math.round(abs / 365.25);
    return `${years} year${years === 1 ? "" : "s"} ${suffix}`;
  }

  function render() {
    const val = dateInput.value; // "YYYY-MM-DD" from the date input, or ""
    resultEl.innerHTML = "";
    if (!val) return;

    const [y, m, d] = val.split("-").map(Number);
    const date = new Date(y, m - 1, d);

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((date - todayMidnight) / 86400000);

    const weekdayEl = document.createElement("div");
    weekdayEl.className = "df-result-weekday";
    weekdayEl.textContent = WEEKDAY_NAMES[date.getDay()];
    resultEl.appendChild(weekdayEl);

    const dateEl = document.createElement("div");
    dateEl.className = "df-result-date";
    dateEl.textContent = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    resultEl.appendChild(dateEl);

    const relEl = document.createElement("div");
    relEl.className = "df-result-relative";
    relEl.textContent = relativeLabel(diffDays);
    resultEl.appendChild(relEl);
  }

  const t = new Date();
  dateInput.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  dateInput.addEventListener("input", render);
  render();
})();
