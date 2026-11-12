/* CEO affairs and the share price.
   Renders window.AFFAIRS (written by fetch_data.py from events.json) as a line
   chart of percent change vs trading day since the story broke, plus KPIs, a
   per-case table and sourced notes. No dependencies, no build step. */
"use strict";

const NS = "http://www.w3.org/2000/svg";
const D = window.AFFAIRS;
const M = D.meta;
const EV = D.events;
const MINUS = "\u2212";

/* ---------- colour + grouping ---------- */
const PALETTE = {
  nvda: "#ffd166", nvda2: "#f59e0b", nvda4: "#fde68a",
  amzn: "#5b9dff", hp: "#f472b6", orcl: "#7dd3fc",
  intc: "#22d3ee", ba: "#fca5a5", lmt: "#5eead4", lhx: "#2dd4bf",
};
const colorOf = (e) => PALETTE[e.color] || "var(--c-other)";
const isFeatured = (e) => !!e.featured;
const SAMPLE = EV;                       // every case in events.json is drawn and listed
const STATS = [...new Map(SAMPLE.filter((e) => !e.noStats).map((e) => [e.ticker, e])).values()];
const headline = EV.find((e) => e.headline) || SAMPLE[0];
const ALL_DAYS = [...new Set(EV.flatMap((e) => e.dates))].sort();
const BUILD_YEAR = Number((M.builtOn || M.asOfDate).slice(0, 4));

/* ---------- formatting ---------- */
const MONTHS_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDM(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS_S[m - 1]}` + (y !== BUILD_YEAR ? ` ${y}` : "");
}
function fmtDMY(iso) {
  if (!iso) return "\u2014";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "\u2014";
  return `${d} ${MONTHS_S[m - 1]} ${y}`;
}
function pct(v, dec = 1) {
  if (v == null || Number.isNaN(v)) return "\u2014";
  const r = Math.round(Math.abs(v) * 10 ** dec) / 10 ** dec;
  if (r === 0) return "0%";
  return (v < 0 ? MINUS : "+") + r.toFixed(dec).replace(/\.0+$/, "") + "%";
}
/* Percentages of a price and percent-point gaps to an index are different things;
   printing both as "%" invites reading a 15-point shortfall as a 15% fall. */
function num(v, dec = 1, mode = state.measure) {
  if (v == null || Number.isNaN(v)) return "\u2014";
  const r = Math.round(Math.abs(v) * 10 ** dec) / 10 ** dec;
  const unit = mode === "excess" ? "pt" : "%";
  if (r === 0) return mode === "excess" ? "0pt" : "0%";
  return (v < 0 ? MINUS : "+") + r.toFixed(dec).replace(/\.0+$/, "") + unit;
}
const cls = (v) => (v == null ? "dim" : v < 0 ? "neg" : v > 0 ? "pos" : "dim");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const BENCH_NAME = M.benchmark && /SPY/i.test(M.benchmark) ? "SPY fund" : "S&P 500";
function money(v, ccy) {
  if (v == null) return "\u2014";
  const sym = { USD: "$", GBP: "\u00a3", EUR: "\u20ac", JPY: "\u00a5" }[ccy] || (ccy || "") + " ";
  return sym + v.toLocaleString("en-US", v >= 1000
    ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function median(xs) {
  const s = xs.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function svgEl(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}
function h(tag, attrs, text) {
  const n = document.createElement(tag);
  for (const k in attrs) { if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]); }
  if (text != null) n.textContent = text;
  return n;
}

/* ---------- derived stats ---------- */
function at(e, field, n) { const s = e[field]; return n < s.length ? s[n] : null; }
for (const e of EV) {
  const trough = Math.min(...e.pct);
  const ti = e.pct.indexOf(trough);
  const back = e.pct.findIndex((v) => v >= 0);
  const xs = e.excess.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
  const tiExcess = xs.length ? xs.reduce((a, b) => (e.excess[b] < e.excess[a] ? b : a), xs[0]) : null;
  // Day 0 is the first session that could trade on the story, so it is the
  // reaction session; day 1 is the one after it. Nothing here is off by one.
  const lastIsLive = !!M.liveDate && e.dates[e.dates.length - 1] === M.liveDate;
  // Settled series: today's in-progress print may sit at the end of a line. Headline
  // numbers, medians and rankings use the settled view, so an unfinished session can
  // never be quoted as if it were a close.
  const sp = lastIsLive ? e.pct.slice(0, -1) : e.pct;
  const sx = lastIsLive ? e.excess.slice(0, -1) : e.excess;
  const sTrough = sp.length ? Math.min(...sp) : null;
  const sTi = sp.length ? sp.indexOf(sTrough) : null;
  const sxs = sx.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
  const sTiExcess = sxs.length ? sxs.reduce((a, b) => (sx[b] < sx[a] ? b : a), sxs[0]) : null;
  e.s = {
    trough, ti,
    tiExcess,
    troughDate: e.dates[ti],
    recovered: back === -1 ? null : back,
    last: e.pct.length - 1,
    lastPct: e.pct[e.pct.length - 1],
    lastIsLive,
    sTrough, sTi,
    sTroughDate: sTi == null ? null : e.dates[sTi],
    sLast: sp.length ? sp[sp.length - 1] : null,
    sLastIdx: sp.length - 1,
    sMinExcess: sxs.length ? sx[sTiExcess] : null,
    d0: at(e, "pct", 0), d1: at(e, "pct", 1), wk: at(e, "pct", 5),
    mo: at(e, "pct", 21), qt: at(e, "pct", 63),
    x0: at(e, "excess", 0), x1: at(e, "excess", 1), x5: at(e, "excess", 5),
    x21: at(e, "excess", 21), x63: at(e, "excess", 63),
    minExcess: xs.length ? e.excess[tiExcess] : null,
  };
}

/* ---------- masthead ---------- */
const lastSettled = (() => {
  const d = [...new Set(EV.flatMap((e) => e.dates))].sort();
  const i = d.lastIndexOf(M.liveDate);
  return M.liveDate && i > 0 ? d[i - 1] : d[d.length - 1];
})();
document.getElementById("asOf").textContent =
  `${STATS.length} cases since ${fmtDMY(STATS.reduce((m, e) => (e.disclosed < m ? e.disclosed : m), "9999"))}` +
  ` \u00b7 closes to ${fmtDMY(lastSettled)}` +
  `${M.liveDate ? `, ${fmtDM(M.liveDate)} still trading` : ""} \u00b7 built ${fmtDMY(M.builtOn)}`;

document.getElementById("lead").textContent = (() => {
  if (!headline) return "Share prices from the session that first traded on each story.";
  const H = headline;
  const out = SAMPLE.find((e) => e.role === "ouster");
  const sorted = [...SAMPLE].sort((a, b) => a.disclosed.localeCompare(b.disclosed));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = first === last ? `${first.company}` : `${first.company} in ${first.disclosed.slice(0, 4)} to ${last.company} in ${last.disclosed.slice(0, 4)}`;
  // Settled figures first; a line whose only point is today's print falls back to
  // it, explicitly labelled, rather than being dropped from the sentence.
  const say = (e) => {
    const v = e.s.sLast != null ? e.s.sLast : e.s.lastPct;
    return `${pct(v)}${(e.s.lastIsLive && e.s.sLast == null) ? " so far today" : ""}`;
  };
  const outClause = out
    ? `, and ${say(out)} on ${fmtDMY(out.dates[out.dates.length - 1])}` +
      `${out.s.lastIsLive ? " (still trading when this was built)" : ""}, the session that priced the ` +
      `${out.boardAction || "board's decision to remove him"}`
    : "";
  return `${H.company}'s shares are ${say(H)} against the close before ${H.ceo} admitted the ` +
    `affair on ${fmtDMY(H.disclosed)}` + outClause +
    `. Each other line is a listed company whose chief executive was caught out, ${span}: the first ` +
    `sessions look much alike, and then they diverge, on two things \u2014 whether the CEO kept the job, and ` +
    `whether the market was falling anyway.`;
})();

function kpi(label, value, sub, kind) {
  const wrap = h("div", { class: "kpi" + (kind ? " " + kind : "") });
  const dd = h("dd", {}, value);
  dd.appendChild(h("small", {}, sub));
  wrap.append(h("dt", {}, label), dd);
  return wrap;
}
function buildKpis() {
  const host = document.getElementById("kpis");
  if (headline) {
    const H = headline;
    const liveAt = (e, i) => (M.liveDate && i != null && e.dates[i] === M.liveDate ? " \u2020" : "");
    const sinceV = H.s.sLast != null ? H.s.sLast : H.s.lastPct;
    host.appendChild(kpi(`${H.company} since the admission`, pct(sinceV),
      `${plural(H.s.sLastIdx < 0 ? H.s.last : H.s.sLastIdx, "session")} from ${fmtDM(H.disclosed)}` +
      `${liveAt(H, H.s.sLastIdx < 0 ? H.s.last : H.s.sLastIdx)}`, sinceV < 0 ? "down" : "flat"));
    if (H.s.sTrough != null)
      host.appendChild(kpi(`${H.company} deepest settled close`, pct(H.s.sTrough, 0),
        `${plural(H.s.sTi, "session")} in, ${fmtDM(H.s.sTroughDate)}${liveAt(H, H.s.sTi)}`, "down"));
  }
  const d1 = STATS.map((e) => e.s.d0);
  const md = median(d1);
  host.appendChild(kpi("Median first session", pct(md),
    `${d1.filter((v) => v != null).length} cases`, md < 0 ? "down" : "flat"));
  const within1 = STATS.filter((e) => e.s.recovered != null && e.s.recovered <= 21).length;
  host.appendChild(kpi("Back above the old close", `${within1}/${STATS.length}`,
    "within a month of the story", "accent"));
  const pool = STATS.filter((e) => e.s.sTrough != null);
  const worst = pool.length ? [...pool].sort((a, b) => a.s.sTrough - b.s.sTrough)[0] : null;
  if (worst && (!headline || worst.id !== headline.id))
    host.appendChild(kpi("Deepest slide elsewhere", pct(worst.s.sTrough, 0),
      `${worst.company}, ${plural(worst.s.sTi, "session")} in`, "down"));
  host.appendChild(kpi("CEOs who lost the job",
    String(STATS.filter((e) => /resign|ouste|sack|dismiss|step|left/.test(e.outcome || "")).length),
    `of ${STATS.length}`, "flat"));
}
buildKpis();

/* ---------- state + controls ---------- */
const PRESETS = [
  ["best", "Headline cases", (e) => isFeatured(e)],
  ["all", `All ${SAMPLE.length}`, (e) => true],
  ["admit", "Admitted it", (e) => e.kind === "admitted"],
  ["stayed", "CEO stayed", (e) => e.outcome === "stayed"],
  ["gone", "CEO out", (e) => /resign|ouste|sack|dismiss|step/.test(e.outcome || "")],
];
const state = {
  preset: "best",
  measure: "pct",
  horizon: 63,
  visible: new Set(EV.filter(isFeatured).map((e) => e.id)),
};
function clearPresetChecks() {
  for (const b of document.querySelectorAll("#presets button")) b.setAttribute("aria-checked", "false");
}
function applyPreset(id) {
  state.preset = id;
  state.visible = new Set(EV.filter(PRESETS.find((p) => p[0] === id)[2]).map((e) => e.id));
  for (const b of document.querySelectorAll("#presets button"))
    b.setAttribute("aria-checked", String(b.dataset.preset === id));
  syncChips();
  draw();
}

/* One tab stop per group, arrows move the selection: what role=radio promises. */
function radioGroup(host, items, isSelected, onPick) {
  const buttons = items.map(([value, label]) => {
    const b = h("button", { type: "button", role: "radio", "data-value": String(value),
      "aria-checked": String(isSelected(value)), tabindex: isSelected(value) ? "0" : "-1" }, label);
    b.addEventListener("click", () => pick(b, value));
    host.appendChild(b);
    return b;
  });
  function pick(b, value) {
    onPick(value);
    for (const x of buttons) {
      const on = x === b;
      x.setAttribute("aria-checked", String(on));
      x.tabIndex = on ? 0 : -1;
    }
  }
  host.addEventListener("keydown", (ev) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  });
  return buttons;
}

const measureHost = document.getElementById("measure");
const horHost = document.getElementById("horizon");
radioGroup(document.getElementById("presets"),
  PRESETS.map(([id, label]) => [id, label]), (id) => id === state.preset, applyPreset);
radioGroup(measureHost,
  [["pct", "Share price"], ["excess", `Vs the ${BENCH_NAME}`]],
  (id) => id === state.measure,
  (id) => { state.measure = id; captions(); draw(); renderTable(); });
radioGroup(horHost,
  [[5, "5 days"], [21, "1 month"], [63, "3 months"], [126, "6 months"], [0, "full"]],
  (v) => Number(v) === state.horizon, (v) => { state.horizon = Number(v); draw(); });

const chipsHost = document.getElementById("chips");
const chipFor = new Map();
for (const e of EV) {
  const c = h("button", { type: "button", class: "chip", "data-id": e.id,
    "aria-pressed": String(state.visible.has(e.id)),
    style: `color:${e.featured || e.headline ? colorOf(e) : "var(--c-other)"}` });
  c.append(h("span", { class: "sw" }));
  c.appendChild(h("span", {}, e.chip || e.company));
  const v = h("span", { class: "v" });
  c.appendChild(v);
  c.addEventListener("click", () => {
    if (state.visible.has(e.id)) state.visible.delete(e.id); else state.visible.add(e.id);
    c.setAttribute("aria-pressed", String(state.visible.has(e.id)));
    clearPresetChecks();          // the selection no longer matches any preset
    draw();
  });
  chipsHost.appendChild(c);
  chipFor.set(e.id, v);
}
// Chip numbers follow the selected measure. A line whose only session is today's
// unsettled print shows that figure with a dagger rather than nothing at all.
function refreshChips() {
  for (const e of EV) {
    const cell = chipFor.get(e.id);
    if (!cell) continue;
    const s = seriesOf(e);
    const lastIsLive = M.liveDate && e.dates[s.length - 1] === M.liveDate;
    const pool = (lastIsLive ? s.slice(0, -1) : s).filter((v) => v != null);
    if (pool.length) cell.textContent = num(Math.min(...pool), 0);
    else if (lastIsLive && s.some((v) => v != null)) cell.textContent = num(s[s.length - 1], 0) + " \u2020";
    else cell.textContent = "\u2014";
  }
}
function syncChips() {
  for (const c of chipsHost.querySelectorAll(".chip"))
    c.setAttribute("aria-pressed", String(state.visible.has(c.dataset.id)));
  refreshChips();
}

/* ---------- chart ---------- */
const chartHost = document.getElementById("chart");
const tipEl = document.getElementById("tooltip");
const seriesOf = (e) => (state.measure === "pct" ? e.pct : e.excess);

function captions() {
  const p = state.measure === "pct";
  document.getElementById("chartTitle").textContent = p
    ? "How the share price moved after the story broke"
    : `How the share price moved against the ${BENCH_NAME}`;
  document.getElementById("chartBlurb").textContent = p
    ? "Each line starts at the close of the last session before the story was public."
    : `Percent points versus the ${BENCH_NAME} over the same sessions, so a market-wide slump stops reading as a scandal.`;
  const at = ALL_DAYS.indexOf(M.asOfDate);
  const prev = at > 0 ? ALL_DAYS[at - 1] : null;
  document.getElementById("chartStamp").textContent = M.liveDate
    ? `Last settled close ${prev ? fmtDMY(prev) : "not yet available"}; ${fmtDMY(M.liveDate)} was still ` +
      `trading when this was built${M.liveStamp ? ` (quote at ${M.liveStamp})` : ""}.`
    : `Closes to ${fmtDMY(M.asOfDate)}.`;
  document.getElementById("chartFoot").textContent = p
    ? "Vertical axis: percent against the close of the last session before the story; 0% is that close. " +
      "Day 0 is the first session the market could trade on the news, which is the next day when a story " +
      "lands after the close. Closes are adjusted for splits, which keeps the lines honest \u2014 but not " +
      "always for dividends, and never to the numbers printed in the paper: Amazon traded around sixteen " +
      "hundred dollars in 2019 and shows near eighty here because of its 2022 twenty-for-one split."
    : `Vertical axis: the stock's percent change minus the ${BENCH_NAME}'s over identical sessions, in percent ` +
      "points (pt), so 0pt means it did exactly what the index did. A gap means no matching index session, and a " +
      "line missing entirely is named under the chart. Non-US listings are compared with a US index, which charges " +
      "them for whatever their own market and currency did.";
}

function rank(e) { return e.headline ? 2 : isFeatured(e) ? 1 : 0; }

function draw() {
  chartHost.replaceChildren();
  tipEl.hidden = true;
  refreshChips();
  const vis = EV.filter((e) => state.visible.has(e.id));
  const avail = chartHost.clientWidth || 640;
  const narrow = avail < 620;                       // not enough room for end labels
  const W = Math.max(avail, narrow ? 320 : 560);
  if (!vis.length) {
    const s0 = svgEl("svg", { viewBox: `0 0 ${W} 120`, role: "img", "aria-label": "No lines selected" });
    s0.appendChild(svgEl("text", { x: 20, y: 60, fill: "var(--ink-faint)", "font-size": 14 },
      "No lines selected \u2014 pick a preset or toggle a chip above."));
    chartHost.appendChild(s0);
    return;
  }
  const H = narrow ? 360 : 470, L = 60, R = narrow ? 16 : 190, T = 20, B = 42;
  const lastIdx = Math.max(...vis.map((e) => seriesOf(e).length - 1));
  const xMax = Math.max(1, state.horizon === 0 ? Math.max(6, lastIdx) : Math.min(state.horizon, lastIdx));
  let lo = 0, hi = 0;
  for (const e of vis) {
    const s = seriesOf(e);
    for (let d = 0; d <= Math.min(xMax, s.length - 1); d++)
      if (s[d] != null) { if (s[d] < lo) lo = s[d]; if (s[d] > hi) hi = s[d]; }
  }
  const pad = Math.max(2.5, (hi - lo) * 0.07);
  const yMin = Math.min(-5, Math.floor((lo - pad) / 5) * 5);
  const yMax = Math.max(5, Math.ceil((hi + pad) / 5) * 5);
  const px = (d) => L + (d / xMax) * (W - L - R);
  const py = (p) => T + ((yMax - p) / (yMax - yMin)) * (H - T - B);
  const unit = state.measure === "excess" ? "pt" : "%";

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", tabindex: "0", "aria-label":
    `${state.measure === "pct" ? "Percent change from the close before each story"
      : `Percent points versus the ${BENCH_NAME}`}, by trading day since the story broke. ` +
      `Left and right arrow keys read off each day.` });

  const grid = svgEl("g", { class: "grid" });
  const stepY = (yMax - yMin) / 10 > 12 ? 20 : 10;
  for (let p = yMax; p >= yMin; p -= stepY) {
    grid.appendChild(svgEl("line", { x1: L, x2: W - R + 8, y1: py(p), y2: py(p) }));
    if (p !== 0) grid.appendChild(svgEl("text", { x: L - 8, y: py(p) + 4, "text-anchor": "end",
      fill: "var(--ink-faint)", "font-size": 11.5 }, (p > 0 ? "+" : MINUS) + Math.abs(p) + unit));
  }
  svg.appendChild(grid);
  svg.appendChild(svgEl("line", { class: "zero", x1: L, x2: W - R + 8, y1: py(0), y2: py(0) }));
  svg.appendChild(svgEl("text", { class: "zeroLabel", x: L, y: py(0) - 6 },
    state.measure === "pct" ? "close before the story" : "moved with the market"));
  svg.appendChild(svgEl("line", { class: "storyMark", x1: px(0), x2: px(0), y1: T, y2: H - B }));
  svg.appendChild(svgEl("text", { class: "storyLabel", x: px(0) + 4, y: T + 10 }, "story broke"));

  const ax = svgEl("g", { class: "axis" });
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => xMax / s <= (narrow ? 4 : 7)) || 100;
  for (let d = 0; d <= xMax; d += step) {
    ax.appendChild(svgEl("line", { x1: px(d), x2: px(d), y1: H - B, y2: H - B + 4, stroke: "var(--line)" }));
    ax.appendChild(svgEl("text", { x: px(d), y: H - B + 18, "text-anchor": "middle" }, String(d)));
  }
  ax.appendChild(svgEl("text", { x: W - R, y: H - 6, "text-anchor": "end", class: "axisTitle" },
    "trading days since the story broke"));
  svg.appendChild(ax);

  const slots = [];
  const silent = [];
  for (const e of [...vis].sort((a, b) => rank(a) - rank(b))) {
    const s = seriesOf(e).slice(0, xMax + 1);
    const pts = s.map((v, i) => (v == null ? null : [px(i), py(v)])).filter(Boolean);
    if (!pts.length) { silent.push(e); continue; }
    // The last point may be today's in-progress session: draw it as a ring on a
    // dashed tail so it can never be mistaken for a settled close.
    const li = M.liveDate ? e.dates.indexOf(M.liveDate) : -1;
    const live = li >= 0 && li === s.length - 1 && s[li] != null;
    const body = live ? pts.slice(0, -1) : pts;
    const clsName = e.headline ? "ongoing" : isFeatured(e) ? "featured" : "context";
    const stroke = clsName === "context" ? "var(--c-other)" : colorOf(e);
    if (body.length >= 2) {
      svg.appendChild(svgEl("path", { class: `linePath ${clsName}`,
        d: body.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(""),
        stroke }));
    } else if (body.length === 1) {
      svg.appendChild(svgEl("circle", { class: "dot", cx: body[0][0], cy: body[0][1], r: 4, fill: stroke }));
    }
    if (live) {
      const from = body.length ? body[body.length - 1] : null;
      const to = pts[pts.length - 1];
      if (from) svg.appendChild(svgEl("line", { class: "liveTail", x1: from[0], y1: from[1],
        x2: to[0], y2: to[1], stroke }));
      svg.appendChild(svgEl("circle", { class: "liveDot", cx: to[0], cy: to[1], r: 4.5,
        fill: "var(--bg)", stroke }));
    }
    if (!narrow && (isFeatured(e) || e.headline)) {
      // Label the last point actually drawn, in the measure now on screen.
      let j = s.length - 1;
      while (j >= 0 && s[j] == null) j--;
      if (j >= 0) {
        slots.push({ y: py(s[j]),
          text: `${e.short || e.company}: ${num(s[j], 0)}` +
            `${live && j === s.length - 1 ? " live" : ""}`,
          color: stroke });
      }
    }
  }
  slots.sort((a, b) => a.y - b.y);
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (i > 0 && s.y < slots[i - 1].y + 15) s.y = slots[i - 1].y + 15;
    s.y = Math.max(T + 12, Math.min(H - B + 6, s.y));
    svg.appendChild(svgEl("text", { class: "endLabel", x: W - R + 14, y: s.y + 4, fill: s.color }, s.text));
  }

  const cross = svgEl("line", { class: "crosshair", y1: T, y2: H - B, x1: -9, x2: -9 });
  const dots = svgEl("g", {});
  svg.append(cross, dots);
  chartHost.appendChild(svg);

  if (silent.length) {
    chartHost.appendChild(h("p", { class: "hint" },
      `Not drawn in this measure (no matching market session at all): ` +
      `${silent.map((e) => e.short || e.company).join(", ")}.`));
  }

  function showDay(d, clientX, clientY) {
    d = Math.max(0, Math.min(xMax, d));
    cross.setAttribute("x1", px(d)); cross.setAttribute("x2", px(d));
    dots.replaceChildren();
    const rows = [];
    for (const e of vis) {
      const s = seriesOf(e);
      if (d >= s.length || s[d] == null) continue;
      rows.push({ name: e.short || `${e.company} \u00b7 ${e.ceo}`, v: s[d],
        color: colorOf(e), date: e.dates[d], price: e.prices[d], ccy: e.currency,
        live: !!M.liveDate && e.dates[d] === M.liveDate });
      dots.appendChild(svgEl("circle", { class: "dot", cx: px(d), cy: py(s[d]), r: 3.4,
        fill: colorOf(e) }));
    }
    if (!rows.length) { tipEl.hidden = true; cross.setAttribute("x1", -9); cross.setAttribute("x2", -9); return; }
    rows.sort((a, b) => a.v - b.v);
    tipEl.hidden = false;
    tipEl.replaceChildren(h("h3", {}, `day ${d} since the story broke`));
    for (const r of rows) {
      const row = h("div", { class: "row" });
      const left = h("span", {});
      left.append(h("span", { class: "sw", style: `background:${r.color}` }),
        `${r.name} \u00b7 ${fmtDM(r.date)}${r.live ? " \u2020" : ""}`);
      row.append(left, h("b", { class: cls(r.v) },
        `${num(r.v)}${r.price != null ? ` \u00b7 ${money(r.price, r.ccy)}` : ""}`));
      tipEl.appendChild(row);
    }
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let tx = clientX + 16;
    if (tx + tw > innerWidth - 8) tx = clientX - tw - 16;
    tx = Math.max(8, Math.min(tx, innerWidth - tw - 8));
    tipEl.style.left = tx + "px";
    tipEl.style.top = Math.max(8, Math.min(innerHeight - th - 8, clientY - th / 2)) + "px";
  }

  svg.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * W;
    showDay(Math.round(((mx - L) / (W - L - R)) * xMax), ev.clientX, ev.clientY);
  });
  svg.addEventListener("mouseleave", () => {
    tipEl.hidden = true; cross.setAttribute("x1", -9); cross.setAttribute("x2", -9); dots.replaceChildren();
  });
  // Keyboard route to the same readout: focus the chart, then step through days.
  let kday = 0;
  svg.addEventListener("focus", () => {
    const r = svg.getBoundingClientRect();
    showDay(kday, r.left + (px(kday) / W) * r.width, r.top + r.height / 2);
  });
  svg.addEventListener("blur", () => { tipEl.hidden = true; });
  svg.addEventListener("keydown", (ev) => {
    const stepK = { ArrowRight: 1, ArrowLeft: -1, PageDown: 10, PageUp: -10 }[ev.key];
    if (stepK) {
      ev.preventDefault();
      kday = Math.max(0, Math.min(xMax, kday + stepK));
      const r = svg.getBoundingClientRect();
      showDay(kday, r.left + (px(kday) / W) * r.width, r.top + r.height / 2);
    } else if (ev.key === "Escape") {
      tipEl.hidden = true; cross.setAttribute("x1", -9); cross.setAttribute("x2", -9); dots.replaceChildren();
    }
  });
}

let raf = 0;
addEventListener("resize", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
function renderTable() {
  const x = state.measure === "excess";
  const thead = document.querySelector("#caseTable thead");
  const tbody = document.querySelector("#caseTable tbody");
  const cols = ["Case", "Story broke", "Day 0", "Day 1", "Week 1", "Month 1", "Quarter",
    "Deepest close", "Sessions to it", "Back above?", "CEO"];
  thead.innerHTML = "<tr>" + cols.map((c) => `<th>${x ? c.replace("close", "vs market") : c}</th>`).join("") + "</tr>";
  tbody.replaceChildren();
  const keys = x ? ["x0", "x1", "x5", "x21", "x63"] : ["d0", "d1", "wk", "mo", "qt"];
  for (const e of [...SAMPLE].sort((a, b) => a.disclosed.localeCompare(b.disclosed))) {
    const tr = h("tr", { class: e.headline ? "ongoing" : "" });
    const first = h("td", {});
    first.append(h("span", { class: "sw", style: `color:${colorOf(e)}` }),
      `${e.company} \u00b7 ${e.ceo}${e.short && e.short !== e.company ? ` (${e.short})` : ""}`);
    tr.appendChild(first);
    tr.appendChild(h("td", { class: "dim" }, `${fmtDMY(e.disclosed)} \u00b7 ${e.outlet}`));
    const dayIdx = [0, 1, 5, 21, 63];
    keys.forEach((k, i) => {
      const v = e.s[k];
      const isLive = M.liveDate && e.dates[dayIdx[i]] === M.liveDate;
      const td = h("td", { class: cls(v) }, num(v) + (isLive ? " \u2020" : ""));
      if (isLive) td.title = `${M.liveDate} is still trading: this is a live price, not a settled close`;
      tr.appendChild(td);
    });
    const trough = x ? e.s.minExcess : e.s.trough;
    const tiShown = x ? e.s.tiExcess : e.s.ti;
    const troughLive = M.liveDate && tiShown != null && e.dates[tiShown] === M.liveDate;
    tr.appendChild(h("td", { class: cls(trough) }, num(trough) + (troughLive ? " \u2020" : "")));
    tr.appendChild(h("td", { class: "dim" }, tiShown == null ? "\u2014" : String(tiShown)));
    tr.appendChild(h("td", { class: "dim" }, e.s.recovered == null ? "not yet" : String(e.s.recovered)));
    tr.appendChild(h("td", { class: "dim" }, e.outcomeLabel || e.outcome || "\u2014"));
    tbody.appendChild(tr);
  }
  document.getElementById("tableTitle").textContent = x
    ? `The cases, measured against the ${BENCH_NAME}` : "The cases, day by day";
  document.getElementById("tableStamp").textContent = x
    ? "Every figure is percent points versus the index over the same sessions."
      : "Percent against the close of the last session before the story.";
  document.getElementById("tableFoot").textContent =
    "\u201cBack above?\u201d counts sessions until the close first returned to the pre-story level; \u201cnot yet\u201d means it " +
    "had not by the last close in the data. The CEO column is what happened to the executive, which is the " +
    "variable the price seems to respond to; \u201cDeepest close\u201d is over the whole window, not only the horizon " +
    "shown." + (M.liveDate
      ? ` \u2020 marks a figure taken from ${fmtDMY(M.liveDate)}, which was still trading when this was built` +
        `${M.liveStamp ? ` (last quote ${M.liveStamp})` : ""}: a live price, not a settled close.`
      : "");
}
renderTable();

/* ---------- findings ---------- */
const FINDINGS = [
  { h: "The first sessions are the loud ones",
    show: (s) => s.n > 0,
    f: (s) => `The median first session across these cases is <b>${pct(s.med0)}</b>, and ${s.down} of ${s.n} ` +
      `closed lower. ` + (s.quick
        ? `<b>${s.quick} of ${s.n}</b> were back above the pre-story close within a month: for those companies ` +
          `the marriage was the news, not the business.`
        : `None of them was back above the pre-story close within a month.`) },
  { h: "What gets sold is doubt about who is in charge",
    show: (s) => s.gone.length && s.stayed.length,
    f: (s) => `The ${plural(s.gone.length, "case")} where the chief executive lost the job bottomed at a median ` +
      `of <b>${pct(s.goneT)}</b> over their windows, while the ${plural(s.stayed.length, "case")} where he kept ` +
      `it bottomed at <b>${pct(s.stayedT)}</b>. The affair is the trigger; the succession is the risk.` },
  { h: "Read every scandal against the tape it landed on",
    show: (s) => s.n > 1 && s.adj,
    f: (s) => (s.raw.id === s.adj.id
      ? `<b>${s.raw.company}</b> is the worst on both measures: ${pct(s.raw.s.sTrough)} against its own pre-story ` +
        `close and ${num(s.raw.s.sMinExcess, 1, "excess")} against the ${BENCH_NAME}, so the market was not the excuse.`
      : `The biggest fall in the share price is <b>${s.raw.company}</b> at ${pct(s.raw.s.sTrough)}, but the largest ` +
        `shortfall <i>after</i> removing the market is <b>${s.adj.company}</b> at ` +
        `${num(s.adj.s.sMinExcess, 1, "excess")}. The two rank the cases differently, which is the point: one ` +
        `number counts the tape and the other does not.`) +
      ` Switch to \u201cvs the ${BENCH_NAME}\u201d to see how much of each line was the market.` },
  { h: "Where the chief executive stayed, the tape barely moved",
    show: (s) => s.calm && Math.abs(s.calm.s.d0) <= 2,
    f: (s) => `<b>${s.calm.company}</b> closed ${pct(s.calm.s.d0)} in the first session that could trade on ` +
      `${s.calm.ceo}` + (s.calm.shrug
        ? `. ${s.calm.shrug}`
        : `, and ${pct(s.calm.s.sTrough)} at its worst across ${plural(s.calm.s.sLastIdx + 1, "settled session")}. ` +
          `With the chief executive still in the chair and no succession to price, the market read the story ` +
          `and moved on.`) },
];
function findingSummary() {
  const d0 = STATS.map((e) => e.s.d0).filter((v) => v != null);
  const withEx = STATS.filter((e) => e.s.sMinExcess != null);
  const withTr = STATS.filter((e) => e.s.sTrough != null);
  return {
    n: d0.length,
    med0: median(d0),
    down: d0.filter((v) => v < 0).length,
    quick: STATS.filter((e) => e.s.recovered != null && e.s.recovered <= 21).length,
    gone: STATS.filter((e) => /resign|ouste|sack|dismiss|step/.test(e.outcome || "")),
    stayed: STATS.filter((e) => e.outcome === "stayed"),
    goneT: median(withTr.filter((e) => /resign|ouste|sack|dismiss|step/.test(e.outcome || ""))
      .map((e) => e.s.sTrough)),
    stayedT: median(withTr.filter((e) => e.outcome === "stayed").map((e) => e.s.sTrough)),
    raw: withTr.length ? [...withTr].sort((a, b) => a.s.sTrough - b.s.sTrough)[0] : null,
    adj: withEx.length ? [...withEx].sort((a, b) => a.s.sMinExcess - b.s.sMinExcess)[0] : null,
    // Only a case where the executive stayed can show a true shrug: a flat day
    // before a removal is a board still deciding, not a market unconcerned.
    calm: (() => {
      const c = STATS.filter((e) => e.outcome === "stayed" && e.s.d0 != null);
      return c.length ? c.reduce((a, b) => (Math.abs(b.s.d0) < Math.abs(a.s.d0) ? b : a)) : null;
    })(),
  };
}
function buildFindings() {
  const host = document.getElementById("findings");
  const s = findingSummary();
  const shown = FINDINGS.filter((it) => { try { return it.show(s); } catch { return false; } });
  for (const it of shown) {
    const d = h("div", { class: "finding" });
    d.appendChild(h("h3", {}, it.h));
    const p = h("p", {});
    p.innerHTML = it.f(s);
    d.appendChild(p);
    host.appendChild(d);
  }
  if (!shown.length) host.appendChild(h("p", { class: "hint" }, "No statistics yet \u2014 no case data was fetched."));
}
buildFindings();

/* ---------- sources + method ---------- */
function buildSources() {
  const host = document.getElementById("sources");
  for (const e of [...EV].sort((a, b) => a.disclosed.localeCompare(b.disclosed))) {
    const wrap = h("div", {});
    wrap.appendChild(h("p", { class: "case" },
      `${e.company} \u00b7 ${e.ticker} \u00b7 ${e.ceo} \u2014 ${e.kindLabel || e.kind}, ${fmtDMY(e.disclosed)}`));
    if (e.what) wrap.appendChild(h("p", {}, e.what));
    const ul = h("ul", {});
    for (const s of e.sources || []) {
      const li = h("li", {});
      li.append(`${s.outlet}${s.date ? ` (${s.date})` : ""} \u2014 `);
      li.appendChild(h("a", { href: s.url, rel: "noopener noreferrer", target: "_blank" }, s.title));
      if (s.note) li.appendChild(document.createTextNode(` \u2014 ${s.note}`));
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    if (e.caveats) wrap.appendChild(h("p", {}, `Caveats: ${e.caveats}`));
    host.appendChild(wrap);
  }
}
buildSources();

function buildMethod() {
  const host = document.getElementById("method");
  for (const p of [
    "Prices are daily closes from Yahoo Finance when it will answer, and otherwise from Nasdaq's own history " +
      "endpoints; the feed used for each ticker is named below. They are split-adjusted \u2014 checked against " +
      "Hewlett-Packard's 2-for-1 of February 2011, which leaves no step in the series \u2014 and indexed to the close " +
      "of the last session before the story became public. Day 0 is the first session the market could have traded " +
      "on the news: where a story landed after the close or at a weekend, day 0 is the next session, and that is " +
      "recorded per case in events.json.",
    "The benchmark is a US large-cap index traded fund, the SPY fund here, indexed off its own close before the " +
      "same session; the exact benchmark and the feed behind every line are named below. \u201cVs the market\u201d " +
      "subtracts one from the other in percent points. Note what that does and does not remove: neither feed " +
      "returns total returns here, so dividends stay out of both sides and largely cancel, but a stock's own " +
      "sector still rides inside its line \u2014 subtracting a broad index does not correct for an AI or semiconductor " +
      "selloff. Non-US listings are compared with a US index, which charges them for whatever their own market and " +
      "currency did.",
    "\u201cCEO infidelity\u201d here means the chief executive of a listed company whose extramarital relationship became " +
      "public. Episodes that were principally about assault, harassment or money paid to keep someone quiet are " +
      "labelled as such rather than folded into the same count, because the market priced them differently; some " +
      "are included where the reporting turns on a concealed relationship, and the source list says which.",
    "The unit of analysis is the company, not the headline. Nvidia appears on the chart three times because the " +
      "story broke three times \u2014 the report, the admission and the removal \u2014 but it is one scandal, so it is " +
      "counted once in the medians and ratios, dated from the admission. The Oracle row is a reaction to the HP " +
      "row, not an independent case, and is likewise drawn but not counted.",
    "Cases are included only where a dated source establishes that a listed company's chief executive had a " +
      "concealed relationship that became public. A guessed date would silently mislabel the whole chart, so " +
      "several stories that were put forward as famous cases are absent. Two were simply untrue: there was no " +
      "Safeway chief executive of the name suggested (his company's own filings name the chairman and chief " +
      "executive on every date in question), and the Xerox affair of 2000 has no subject \u2014 a headline sweep of " +
      "the Los Angeles Times across those fourteen months found no such story, and what Xerox was doing in 2000 " +
      "was replacing a chief executive over a profit collapse. A 2009 Citigroup banking chief could not be traced " +
      "in Citigroup's own annual report, where the job belonged to someone else; asked to recall the name three " +
      "times, the answer was three different people, which is the whole argument for checking filings instead of " +
      "memory. Undated and therefore left out: a 2015 Las Vegas Sands chief executive, a 2012 Morgan Stanley " +
      "co-president, a 2022 Disney chief executive's email, and a 2024 Liberty Media payment said to settle a " +
      "2011 relationship, for which no article at all could be found. Two further episodes were excluded on " +
      "framing rather than evidence: a Google co-founder's handling of a misconduct claim, which is not a story " +
      "about a marriage, and a BP chief executive's 2007 resignation, which was an outing as much as an affair.",
    "Press figures for pre-market and after-hours trading are not drawn: only official session closes are. Where a " +
      "news number differs from the move computed here, that gap or a different anchor session is usually why \u2014 " +
      "several stories in this set broke after the close, so the damage printed the next morning.",
    "A price move is not proof of a cause. These windows contain earnings, macro shocks and, in several cases, " +
      "other revelations about the same executive. Each row lists what else was in the tape. Generated from " +
      "events.json by fetch_data.py; analysis, not investment advice.",
  ]) host.appendChild(h("p", {}, p));
  host.appendChild(h("p", {},
    `Benchmark used in this build: ${M.benchmark || "none"}. Percentages of each stock are unaffected by the ` +
    `choice; only the versus-market column is.`));
  const feeds = Object.entries(M.feeds || {});
  if (feeds.length)
    host.appendChild(h("p", {}, "Price feeds: " + feeds.map(([k, v]) => `${k} ${v}`).join(", ") + "."));
  if (M.unresolved && M.unresolved.length) {
    host.appendChild(h("p", {}, "Not plotted in this build, and why:"));
    const ul = h("ul", {});
    for (const u of M.unresolved) ul.appendChild(h("li", {}, u));
    host.appendChild(ul);
  }
}
buildMethod();

captions();
draw();
