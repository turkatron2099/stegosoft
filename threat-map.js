// Threat Map: animates threats.json (built every 2 hours by
// scripts/build-threats.mjs) on a canvas world map. The snapshot is a day's
// worth of totals, not individual events, so the "live" feel is a weighted
// replay: busier sources and routes simply get picked more often.
(function () {
  const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
  const REFRESH_MS = 10 * 60 * 1000;
  const FEED_MAX = 8;
  // An origin ring stays this long after its rock is thrown (rocks fly for
  // up to ~1.7 s, then the impact shows for IMPACT_MS), then fades out over
  // ORIGIN_FADE.
  const ORIGIN_LINGER = 2200;
  const IMPACT_MS = 1000;
  const ORIGIN_FADE = 800;
  const COLORS = {
    land: "#0d2b48",
    border: "#1d4f63",
    source: "248, 85, 37",
    L3: "250, 169, 104",
    L7: "232, 111, 216",
    c2: "140, 191, 184",
    origin: "246, 220, 172",
  };

  const canvas = document.getElementById("tm-canvas");
  const mapEl = document.getElementById("tm-map");
  const tooltip = document.getElementById("tm-tooltip");
  const message = document.getElementById("tm-message");
  const feedEl = document.getElementById("tm-feed");
  const updatedEl = document.getElementById("tm-updated");
  const ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let regionNames = null;
  try {
    regionNames = new Intl.DisplayNames(["en"], { type: "region" });
  } catch {}
  const countryName = (code) => {
    try {
      return (regionNames && regionNames.of(code)) || code;
    } catch {
      return code;
    }
  };
  const fmt = new Intl.NumberFormat("en");
  const fmtCompact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

  let land = null;
  let borders = null;
  let data = null;
  let projection = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  // Marker size multiplier, so dots and arcs stay visible on a big
  // full-screen display instead of shrinking to specks.
  let mark = 1;
  let baseLayer = null;
  let sourcePoints = [];
  let c2Points = [];
  let originPoints = [];
  let effects = [];
  let nextSpawn = 0;
  let pickSource = null;
  let pickArc = null;

  // ---- data ----

  async function loadWorld() {
    const topo = await fetch(WORLD_URL).then((r) => r.json());
    // Antarctica (ISO 010) only wastes the bottom of the map.
    topo.objects.countries.geometries = topo.objects.countries.geometries.filter((g) => g.id !== "010");
    land = topojson.feature(topo, topo.objects.countries);
    borders = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  }

  async function loadThreats() {
    const res = await fetch("threats.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // Returns a function that picks an item with probability proportional to
  // weight(item).
  function weightedPicker(items, weight) {
    if (!items.length) return null;
    const cumulative = [];
    let total = 0;
    for (const item of items) {
      total += Math.max(weight(item), 0.0001);
      cumulative.push(total);
    }
    return () => {
      const r = Math.random() * total;
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < r) lo = mid + 1;
        else hi = mid;
      }
      return items[lo];
    };
  }

  function applyData(snapshot) {
    data = snapshot;
    pickSource = weightedPicker(data.sources, (s) => Math.sqrt(s.targets));
    pickArc = weightedPicker(data.arcs, (a) => a.share);
    document.getElementById("tm-legend-l3").hidden = !data.arcs.some((a) => a.layer === "L3");
    document.getElementById("tm-legend-l7").hidden = !data.arcs.some((a) => a.layer === "L7");
    document.getElementById("tm-legend-c2").hidden = !data.c2.length;
    document.getElementById("tm-legend-origin").hidden = !data.arcs.length;
    renderUpdated();
    renderStats();
    if (projection) {
      placePoints();
      if (reducedMotion) drawFrame(performance.now());
    }
  }

  // ---- side panels ----

  function renderUpdated() {
    if (!data) return;
    const mins = Math.round((Date.now() - Date.parse(data.generatedAt)) / 60000);
    let ago;
    if (mins < 1) ago = "just now";
    else if (mins < 60) ago = mins + " min ago";
    else ago = Math.round(mins / 60) + " hr ago";
    updatedEl.textContent = "Snapshot updated " + ago;
  }

  function renderBars(listEl, rows) {
    listEl.replaceChildren();
    const max = Math.max(...rows.map((r) => r.value), 1);
    for (const row of rows) {
      const li = document.createElement("li");
      const label = document.createElement("div");
      label.className = "tm-bar-label";
      const name = document.createElement("span");
      name.textContent = row.label;
      const value = document.createElement("span");
      value.textContent = row.display;
      label.append(name, value);
      const track = document.createElement("div");
      track.className = "tm-bar-track";
      const fill = document.createElement("div");
      fill.className = "tm-bar-fill";
      fill.style.width = (row.value / max) * 100 + "%";
      track.append(fill);
      li.append(label, track);
      listEl.append(li);
    }
  }

  function renderStats() {
    const byCountry = new Map();
    for (const s of data.sources) byCountry.set(s.country, (byCountry.get(s.country) || 0) + 1);
    renderBars(
      document.getElementById("tm-countries"),
      [...byCountry]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([code, n]) => ({ label: countryName(code), value: n, display: n + (n === 1 ? " IP" : " IPs") }))
    );

    renderBars(
      document.getElementById("tm-ports"),
      data.ports.slice(0, 8).map((p) => ({
        label: p.port + (p.name ? " · " + p.name : ""),
        value: p.records,
        display: fmtCompact.format(p.records) + " reports",
      }))
    );

    // Each Radar route's share is a % of all attacks at its layer, so a
    // target's share is its routes summed per layer, averaged over layers.
    const layers = new Set(data.arcs.map((a) => a.layer));
    const byTarget = new Map();
    for (const a of data.arcs) byTarget.set(a.to, (byTarget.get(a.to) || 0) + a.share / layers.size);
    const targetsCard = document.getElementById("tm-targets-card");
    targetsCard.hidden = !byTarget.size;
    renderBars(
      document.getElementById("tm-targets"),
      [...byTarget]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([code, share]) => ({ label: countryName(code), value: share, display: share.toFixed(1) + "%" }))
    );
  }

  function addFeed(tag, tagClass, text) {
    const li = document.createElement("li");
    const time = document.createElement("span");
    time.className = "tm-feed-time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const t = document.createElement("span");
    t.className = "tm-tag " + tagClass;
    t.textContent = tag;
    const body = document.createElement("span");
    body.className = "tm-feed-text";
    body.textContent = text;
    li.append(time, t, body);
    li.title = text;
    feedEl.prepend(li);
    while (feedEl.children.length > FEED_MAX) feedEl.lastElementChild.remove();
  }

  // ---- map drawing ----

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    mark = Math.max(1, Math.min(width / 1100, 2.2));
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    projection = d3.geoNaturalEarth1().fitExtent(
      [
        [6, 6],
        [width - 6, height - 6],
      ],
      land
    );
    drawBase();
    placePoints();
    effects = [];
    // Resizing the canvas clears it, so repaint now rather than leaving it
    // blank until the next animation frame.
    drawFrame(performance.now());
  }

  function drawBase() {
    baseLayer = document.createElement("canvas");
    baseLayer.width = canvas.width;
    baseLayer.height = canvas.height;
    const b = baseLayer.getContext("2d");
    b.scale(dpr, dpr);
    const path = d3.geoPath(projection, b);
    b.beginPath();
    path(d3.geoGraticule10());
    b.strokeStyle = "rgba(42, 107, 120, 0.18)";
    b.lineWidth = 0.5;
    b.stroke();
    b.beginPath();
    path(land);
    b.fillStyle = COLORS.land;
    b.fill();
    b.beginPath();
    path(borders);
    b.strokeStyle = COLORS.border;
    b.lineWidth = 0.5;
    b.stroke();
  }

  function placePoints() {
    if (!data || !projection) return;
    const maxTargets = Math.max(...data.sources.map((s) => s.targets), 1);
    sourcePoints = data.sources
      .map((s) => {
        const p = projection([s.lon, s.lat]);
        return p && { ...s, x: p[0], y: p[1], r: mark * (1.2 + 3.3 * Math.sqrt(s.targets / maxTargets)) };
      })
      .filter(Boolean);
    c2Points = data.c2
      .map((c) => {
        const [lat, lon] = data.countries[c.country];
        const p = projection([lon, lat]);
        return p && { ...c, x: p[0], y: p[1] };
      })
      .filter(Boolean);

    // Radar only says which country a route starts in, not which IPs, so
    // each origin country gets one ring at its center, sized by its share.
    // A ring only shows while one of its arcs is in flight (see ORIGIN_LINGER).
    const byOrigin = new Map();
    for (const a of data.arcs) {
      const o = byOrigin.get(a.from) || { country: a.from, L3: 0, L7: 0 };
      o[a.layer] += a.share;
      byOrigin.set(a.from, o);
    }
    const maxShare = Math.max(...[...byOrigin.values()].map((o) => o.L3 + o.L7), 0.0001);
    originPoints = [...byOrigin.values()]
      .map((o) => {
        const p = countryXY(o.country);
        return p && { ...o, x: p[0], y: p[1], r: mark * (3 + 5 * Math.sqrt((o.L3 + o.L7) / maxShare)), active: -Infinity };
      })
      .filter(Boolean);
  }

  // How visible an origin ring is: fully while its latest arc is flying,
  // then fading out. With reduced motion there are no arcs, so all show.
  function originAlpha(o, now) {
    if (reducedMotion) return 1;
    const age = now - o.active;
    if (age < ORIGIN_LINGER) return 1;
    return Math.max(0, 1 - (age - ORIGIN_LINGER) / ORIGIN_FADE);
  }

  function countryXY(code) {
    const c = data.countries[code];
    return c ? projection([c[1], c[0]]) : null;
  }

  function spawn(now) {
    const roll = Math.random();
    if (pickArc && roll < 0.55) {
      const arc = pickArc();
      const a = countryXY(arc.from);
      const b = countryXY(arc.to);
      if (!a || !b) return;
      const label = arc.layer === "L3" ? "of network DDoS" : "of web attacks";
      addFeed(arc.layer, "tm-tag-" + arc.layer.toLowerCase(), `${countryName(arc.from)} → ${countryName(arc.to)} · ${arc.share.toFixed(1)}% ${label}`);
      if (arc.from === arc.to) {
        effects.push({ kind: "ring", x: a[0], y: a[1], color: COLORS[arc.layer], start: now, dur: 1400, size: 18 });
        return;
      }
      const origin = originPoints.find((o) => o.country === arc.from);
      if (origin) origin.active = now;
      effects.push({ kind: "ring", x: a[0], y: a[1], color: COLORS[arc.layer], start: now, dur: 900, size: 10 });
      const flight = 1200 + Math.random() * 500;
      effects.push({ kind: "arc", a, b, color: COLORS[arc.layer], start: now, flight, dur: flight + IMPACT_MS, rock: makeRock(), impact: makeImpact() });
    } else if (c2Points.length && roll > 0.97) {
      const c = c2Points[Math.floor(Math.random() * c2Points.length)];
      addFeed("C2", "tm-tag-c2", `${c.malware} server ${c.ip}:${c.port} · ${countryName(c.country)}`);
      effects.push({ kind: "ring", x: c.x, y: c.y, color: COLORS.c2, start: now, dur: 1800, size: 22 });
    } else if (pickSource) {
      const s = pickSource();
      const p = projection([s.lon, s.lat]);
      if (!p) return;
      addFeed("SCAN", "tm-tag-src", `${s.ip} · ${countryName(s.country)} · hit ${fmt.format(s.targets)} sensors`);
      effects.push({ kind: "ring", x: p[0], y: p[1], color: COLORS.source, start: now, dur: 1300, size: 14 });
    }
  }

  function bezierPoint(a, c, b, t) {
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  }

  // A lumpy polygon for a thrown rock: points around a circle, each pushed
  // in or out a little so no two rocks look the same.
  function makeRock() {
    const n = 6 + Math.floor(Math.random() * 3);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      pts.push([Math.cos(ang), Math.sin(ang), 0.68 + Math.random() * 0.32]);
    }
    return { pts, size: 0.85 + Math.random() * 0.35, spin: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6) };
  }

  // Comic-style impact: lines bursting out of the landing spot, plus a few
  // chips of rock thrown up that fall back down.
  function makeImpact() {
    const n = 7 + Math.floor(Math.random() * 3);
    const lines = [];
    for (let i = 0; i < n; i++) {
      lines.push({ ang: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, len: 0.7 + Math.random() * 0.5 });
    }
    const chips = [];
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      chips.push({ vx: Math.cos(ang) * (10 + Math.random() * 10), vy: Math.sin(ang) * (12 + Math.random() * 10), size: 0.6 + Math.random() * 0.6 });
    }
    return { lines, chips };
  }

  function rockPath(rock, x, y, r, rot) {
    ctx.beginPath();
    rock.pts.forEach(([cx, cy, k], i) => {
      const px = cx * Math.cos(rot) - cy * Math.sin(rot);
      const py = cx * Math.sin(rot) + cy * Math.cos(rot);
      if (i) ctx.lineTo(x + px * k * r, y + py * k * r);
      else ctx.moveTo(x + px * k * r, y + py * k * r);
    });
    ctx.closePath();
  }

  function drawArc(e, now) {
    const [ax, ay] = e.a;
    const [bx, by] = e.b;
    const dist = Math.hypot(bx - ax, by - ay);
    // Lob every rock upward (toward the top of the map), higher for long routes.
    const control = e.control || (e.control = [(ax + bx) / 2, (ay + by) / 2 - Math.min(dist * 0.35, height * 0.3)]);
    const elapsed = now - e.start;
    const t = Math.min(elapsed / e.flight, 1);

    if (t < 1) {
      // Dust trail: fading puffs at earlier points along the path.
      for (let i = 1; i <= 6; i++) {
        const tt = t - i * 0.035;
        if (tt <= 0) break;
        const p = bezierPoint(e.a, control, e.b, tt);
        ctx.beginPath();
        ctx.arc(p[0], p[1], (1.6 - i * 0.18) * mark, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${e.color}, ${0.45 - i * 0.065})`;
        ctx.fill();
      }
      // The rock looks bigger at the top of its arc, like it's closer.
      const h = bezierPoint(e.a, control, e.b, t);
      const r = 4.4 * mark * e.rock.size * (1 + 0.45 * Math.sin(Math.PI * t));
      const rot = (elapsed / 1000) * e.rock.spin;
      rockPath(e.rock, h[0], h[1], r, rot);
      ctx.fillStyle = `rgb(${e.color})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 20, 34, 0.85)";
      ctx.lineWidth = 1 * mark;
      ctx.stroke();
      // A darker lower half gives the rock some shading.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(8, 20, 34, 0.35)";
      ctx.fillRect(h[0] - r, h[1] + r * 0.15, r * 2, r);
      ctx.restore();
      return;
    }

    // Landed: impact lines pop out fast, hold, then fade over IMPACT_MS.
    const k = (elapsed - e.flight) / IMPACT_MS;
    const pop = Math.min(k / 0.12, 1);
    const grow = 1 - Math.pow(1 - pop, 3);
    const alpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
    const inner = (4 + 3 * grow) * mark;
    ctx.lineCap = "round";
    ctx.lineWidth = 1.8 * mark;
    ctx.strokeStyle = `rgba(${e.color}, ${alpha})`;
    for (const l of e.impact.lines) {
      const outer = inner + 9 * l.len * grow * mark;
      const cx = Math.cos(l.ang);
      const cy = Math.sin(l.ang);
      ctx.beginPath();
      ctx.moveTo(bx + cx * inner, by + cy * inner);
      ctx.lineTo(bx + cx * outer, by + cy * outer);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    // Chips of rock bounce up and fall back under gravity.
    const s = k * (IMPACT_MS / 1000);
    for (const c of e.impact.chips) {
      const x = bx + c.vx * s * mark;
      const y = by + (c.vy * s + 60 * s * s) * mark;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 * c.size * mark, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${e.color}, ${alpha * 0.9})`;
      ctx.fill();
    }
    // A brief white flash right at the landing spot.
    if (k < 0.2) {
      ctx.beginPath();
      ctx.arc(bx, by, (2 + 6 * (k / 0.2)) * mark, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * (1 - k / 0.2)})`;
      ctx.fill();
    }
  }

  function drawFrame(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseLayer) ctx.drawImage(baseLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const o of originPoints) {
      const alpha = originAlpha(o, now);
      if (!alpha) continue;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${COLORS.origin}, ${0.08 * alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${COLORS.origin}, ${0.6 * alpha})`;
      ctx.lineWidth = 1.2 * mark;
      ctx.stroke();
    }

    for (const s of sourcePoints) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${COLORS.source}, 0.55)`;
      ctx.fill();
    }

    const pulse = reducedMotion ? 0.5 : (Math.sin(now / 400) + 1) / 2;
    for (const c of c2Points) {
      const r = (4 + pulse * 1.5) * mark;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - r);
      ctx.lineTo(c.x + r, c.y);
      ctx.lineTo(c.x, c.y + r);
      ctx.lineTo(c.x - r, c.y);
      ctx.closePath();
      ctx.fillStyle = `rgba(${COLORS.c2}, ${0.6 + pulse * 0.4})`;
      ctx.fill();
    }

    effects = effects.filter((e) => now - e.start < e.dur);
    for (const e of effects) {
      const progress = (now - e.start) / e.dur;
      if (e.kind === "arc") {
        drawArc(e, now);
      } else {
        ctx.beginPath();
        ctx.arc(e.x, e.y, (2 + progress * e.size) * mark, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${e.color}, ${1 - progress})`;
        ctx.lineWidth = 1.5 * mark;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x, e.y, 2.5 * mark, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${e.color}, ${1 - progress})`;
        ctx.fill();
      }
    }
  }

  function loop(now) {
    if (data && now >= nextSpawn) {
      // Catch up gently after the tab was in the background instead of
      // firing a burst of every missed event at once.
      if (now - nextSpawn > 2000) nextSpawn = now;
      spawn(now);
      nextSpawn += 260 + Math.random() * 420;
    }
    drawFrame(now);
    requestAnimationFrame(loop);
  }

  // ---- hover tooltip ----

  function showTooltip(clientX, clientY) {
    if (!data) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestDist = 12;
    for (const c of c2Points) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestDist) {
        best = { kind: "c2", item: c };
        bestDist = d;
      }
    }
    if (!best) {
      for (const s of sourcePoints) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bestDist) {
          best = { kind: "source", item: s };
          bestDist = d;
        }
      }
    }
    if (!best) {
      for (const o of originPoints) {
        if (!originAlpha(o, performance.now())) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < Math.max(bestDist, o.r + 4)) {
          best = { kind: "origin", item: o };
          bestDist = d;
        }
      }
    }
    if (!best) {
      tooltip.hidden = true;
      return;
    }
    tooltip.replaceChildren();
    const title = document.createElement("strong");
    const detail = document.createElement("div");
    if (best.kind === "c2") {
      title.textContent = `${best.item.malware} control server`;
      detail.textContent = `${best.item.ip}:${best.item.port} · ${countryName(best.item.country)}`;
    } else if (best.kind === "origin") {
      const parts = [];
      if (best.item.L7) parts.push(`${best.item.L7.toFixed(1)}% of web attacks`);
      if (best.item.L3) parts.push(`${best.item.L3.toFixed(1)}% of network DDoS`);
      title.textContent = countryName(best.item.country);
      detail.textContent = "Origin of " + parts.join(", ");
    } else {
      title.textContent = best.item.ip;
      detail.textContent = `${countryName(best.item.country)} · hit ${fmt.format(best.item.targets)} sensors, ${fmt.format(best.item.reports)} reports`;
    }
    tooltip.append(title, detail);
    tooltip.style.left = Math.min(Math.max(best.item.x, 120), width - 120) + "px";
    tooltip.style.top = best.item.y + "px";
    tooltip.hidden = false;
  }

  canvas.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY));
  canvas.addEventListener("pointerdown", (e) => showTooltip(e.clientX, e.clientY));
  canvas.addEventListener("pointerleave", () => (tooltip.hidden = true));

  // ---- full screen (TV mode) ----
  // Uses the Fullscreen API where it exists, and otherwise (iPhone Safari)
  // just pins the map over the page with CSS. Either way the attack feed
  // card moves into the map as a bottom-left overlay, and goes back to its
  // place in the grid on exit.

  const box = document.getElementById("tm-map-box");
  const fsBtn = document.getElementById("tm-fullscreen");
  const feedCard = document.getElementById("tm-feed-card");
  const feedHome = feedCard.parentNode;
  const feedNext = feedCard.nextSibling;
  let cursorTimer = 0;

  function setFullscreenLayout(on) {
    box.classList.toggle("is-fullscreen", on);
    document.body.classList.toggle("tm-fs-open", on);
    if (on) mapEl.append(feedCard);
    else feedHome.insertBefore(feedCard, feedNext);
    fsBtn.textContent = on ? "Exit full screen" : "Full screen";
    fsBtn.setAttribute("aria-pressed", String(on));
    tooltip.hidden = true;
    wakeCursor();
  }

  function toggleFullscreen() {
    const on = !box.classList.contains("is-fullscreen");
    if (box.requestFullscreen) {
      if (on) box.requestFullscreen().catch(() => setFullscreenLayout(true));
      else if (document.fullscreenElement) document.exitFullscreen();
      else setFullscreenLayout(false);
    } else {
      setFullscreenLayout(on);
    }
  }

  // Hide the mouse pointer after a few idle seconds, so it doesn't sit in
  // the middle of a TV screen.
  function wakeCursor() {
    box.classList.remove("is-idle");
    clearTimeout(cursorTimer);
    if (box.classList.contains("is-fullscreen")) cursorTimer = setTimeout(() => box.classList.add("is-idle"), 3000);
  }

  fsBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", () => setFullscreenLayout(document.fullscreenElement === box));
  box.addEventListener("pointermove", wakeCursor);
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "f" || e.key === "F") toggleFullscreen();
    // Esc only needs handling for the CSS fallback; real full screen
    // exits on its own and fires fullscreenchange.
    if (e.key === "Escape" && !document.fullscreenElement && box.classList.contains("is-fullscreen")) setFullscreenLayout(false);
  });

  // ---- startup ----

  async function refresh() {
    try {
      applyData(await loadThreats());
    } catch (err) {
      console.warn("Threat Map refresh failed:", err);
    }
  }

  async function start() {
    try {
      const [snapshot] = await Promise.all([loadThreats(), loadWorld()]);
      applyData(snapshot);
    } catch (err) {
      console.error(err);
      message.textContent = "Couldn't load the threat data. Check your connection and try again.";
      updatedEl.textContent = "";
      return;
    }
    message.hidden = true;
    resize();
    new ResizeObserver(() => resize()).observe(mapEl);
    setInterval(refresh, REFRESH_MS);
    setInterval(renderUpdated, 60 * 1000);
    if (reducedMotion) {
      // No animation: show a still map and fill the feed with the top
      // sources and routes instead.
      for (const a of data.arcs.slice(0, 6).reverse()) {
        addFeed(a.layer, "tm-tag-" + a.layer.toLowerCase(), `${countryName(a.from)} → ${countryName(a.to)} · ${a.share.toFixed(1)}%`);
      }
      for (const s of data.sources.slice(0, 8).reverse()) {
        addFeed("SCAN", "tm-tag-src", `${s.ip} · ${countryName(s.country)} · hit ${fmt.format(s.targets)} sensors`);
      }
      drawFrame(performance.now());
    } else {
      requestAnimationFrame(loop);
    }
  }

  start();
})();
