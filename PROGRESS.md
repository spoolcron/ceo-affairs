# PROGRESS

Goal: a GitHub Pages site, in the style of spoolcron.github.io/ai-crash, plotting
a listed company's share price after its CEO's infidelity became public, headed by
the Nvidia / Jensen Huang story against the verified precedents.

**PUBLISHED**: https://spoolcron.github.io/ceo-affairs/ (repo `spoolcron/ceo-affairs`,
Pages from `main`, verified rendering live with zero console errors).
Refresh with `python3 fetch_data.py && ./deploy.sh`; see README.md.

## Done

- Reference site read: hand-rolled SVG, `window.CRASH` data module, presets +
  horizon + chips + tooltip + tables, dark palette. Same structure followed.
- Nvidia timeline established and **verified first-hand**, not just via the agent:
  Nvidia's own newsroom carries "A Message to Our Company" (8 Nov 2026, the
  admission: "I was unfaithful to my wife") and "NVIDIA Announces CEO Transition"
  (12 Nov 2026, resignation effective immediately, Kress interim, Jones first-ever
  chair). The NYT pieces are 29 Oct (spy plot / Alice Huang) and 11 Nov (Kimberly
  Powell, an executive reporting to him).
- Session closes cross-checked against **two independent feeds** (Yahoo adjclose and
  Nasdaq): 6 Oct record $239.24, 6 Nov $186.64, 9 Nov $178.67 (-4.27%), 10 Nov
  $168.89 (-5.47%), 11 Nov $173.73 (+2.87%). They agree to the basis point.
- `fetch_data.py`: curl with pacing + jittered backoff, a throttle circuit breaker
  with a 5-minute cooldown, adjusted closes drive returns, as-traded closes drive
  the tooltip, per-event `anchor` for day 0, benchmark chain (^GSPC then SPY) with
  the chosen benchmark named in the page, feed named per line, unresolved rows
  listed rather than dropped silently.
- Two feeds wired: Yahoo (deep + split-adjusted) and Nasdaq (table for recent,
  `chart` endpoint for deep but as-traded, so lines from it are flagged and a
  40-point one-session fall is refused as a split artefact rather than drawn).
- Page: two measures (share price / vs market), five presets, five horizons,
  chips, crosshair tooltip with traded price, per-case table, findings computed
  from the data, sources panel, method panel that names what was excluded.

## Cases that survived verification (10 rows, 7 counted companies)

Nvidia x3 (29 Oct report, 8 Nov admission, 11/12 Nov second affair + ouster),
Boeing/Stonecipher 2005, HP/Hurd 2010, Oracle hiring Hurd 2010, Amazon/Bezos 2019,
Intel/Krzanich 2018, Lockheed/Kubasik 2012, L3Harris/Kubasik 2026.

## Killed during verification — do not re-add from memory

Every one of these was a confident-sounding premise of mine that documents
contradicted:
- **Safeway "Steve Candry"** — no such executive; Burd was chairman/CEO.
- **Yahoo "Doug Daft"** — Daft was at Coca-Cola, never at Yahoo.
- **Xerox "Gary Wilson"** — no such Xerox executive; the 2000 succession crisis
  was Thoman/Allaire and was about earnings. A 14-month LA Times headline sweep
  found no affair story.
- **Citigroup "Anthony Marshall"** — absent from Citi's own 2009 annual report; the
  named job belonged to Ajay Banga and Maura Markus. Control experiment: three
  separate recalls produced three different names, which is the lesson.
- **Liberty Media "Maffei $190m 2011 settlement"** — zero sources in WSJ indexes,
  Wikipedia, EDGAR or trade press.
- Undated and therefore dropped: Las Vegas Sands/Goldstein 2015, Morgan
  Stanley/Kindler 2012, Disney/Chapek 2022, Google/Brin.
- Google/Rubin specifically is misconduct, not infidelity; BP/Browne is an outing,
  not a cheating story. Both wrong for this page on framing, not just on dates.

## Next

Done. Two reviewer subagents found 20 defects; the material ones fixed:

- **P0**: trimming the "dead" colour palette had orphaned `var(--c-nvda)`, and
  because a CSS rule outranks the `stroke` attribute, the headline Nvidia line was
  invisible. Colours now come only from the attribute; verified amber on the live
  site.
- Percent-point gaps read as "%" (HP's "-22.3%" was really 22.3pt vs the index) —
  now `pt` in axis, table, chips, tooltip and prose.
- Live prints leaked into "settled" headlines: lead, KPIs and findings now use
  settled-only statistics, with a dagger for a line whose only point is today.
- Tooltip stamped one case's date on every row; dates are now per row, names use
  the disambiguating short label, and the box is clamped inside the viewport.
- `captions()` crashed the whole page on a single-date dataset, and a case whose
  only session is live crashed `fmtDM(null)` — both reproduced and fixed.
- `_covers` accepted a benchmark 12 days short and froze the excess tail; end
  slack tightened and forward-fill capped at 5 days.
- Split gate lowered from -40 to -25 points (a 3-for-2 split is -33 and was
  passing through), feed claims corrected after proving the Nasdaq series *is*
  back-adjusted, malformed feed responses isolated per ticker.
- Radio groups now behave like radio groups (one tab stop, arrow keys); the chart
  is keyboard-readable; chips follow the selected measure.
- "HP fell 17 cents" and "the S&P 500 fell 1.2%" corrected to what the data
  supports; index naming made consistent with the SPY benchmark actually used.

## Done since last update

- All 10 rows resolve with real closes; every published number cross-checked
  against the reporting (Boeing $58.30/-0.14%, HP -8%, Oracle +5.87% to $24.26,
  Nvidia -4.27% on 9 Nov, Intel -2.38%, Amazon +0.17%). All matched.
- Anchors verified against the calendar: Sun 8 Nov 2026 -> Mon; Fri 6 Aug 2010
  (filed 7:20pm PT) -> Mon; Mon 6 Sep 2010 Labor Day -> Tue; Sun 16 Aug 2026 -> Mon.
- Live 12 Nov session added as a clearly marked provisional point (ring on a
  dashed tail, dagger in table and KPIs, footnote with the quote timestamp);
  kicker now reads "closes to 11 Nov 2026, 12 Nov still trading".
- Fallback feed proved to be back-adjusted via HP's Feb 2011 2-for-1; 40-point
  one-session gate added as a belt-and-braces check.
- Fixed findings that would have misspoken: "flattest" now only considers cases
  where the CEO stayed (it had picked pre-removal Lockheed); medians count each
  company once, so Nvidia's three disclosures are one scandal and Oracle's hire
  is excluded as a reaction.
- Verified in browser: both measures, all five presets, all horizons, chips,
  empty state, tooltip at day 0 and day 63, 390px viewport, zero console errors.

## Notes

- Yahoo 429s this shared IP; three research agents hammering it with `px.py` made
  it far worse. Subagents must not be given quote-API work without serialising it.
- The token is used for the API call and the push only; never committed, never in
  `.git/config`, never in a file in this tree.
- It is ~10:25 ET Thu 12 Nov: today's session is live, so any "close" for 12 Nov is
  provisional and must be labelled as such.
