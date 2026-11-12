# The CEO affair premium

What happens to a listed company's share price when its chief executive's
infidelity becomes public. Headed by Nvidia after Jensen Huang's 8 November 2026
admission, set against every other case that could be documented from a dated
source.

Static page, no dependencies and no build step: `index.html`, `styles.css`,
`app.js`, driven by a generated `data.js`.

## Layout

| file | role |
| ---- | ---- |
| `events.json` | the case list: dates, day-0 anchors, sources, caveats. Hand-authored; the only input. |
| `fetch_data.py` | pulls daily closes, indexes them, writes `data.js`. `--check` reports coverage. |
| `data.js` | generated. Never hand-edit. |
| `index.html`, `styles.css`, `app.js` | the page. |
| `deploy.sh` | publishes to GitHub Pages with `GH_TOKEN` from the environment. |
| `.cache/` | raw feed responses, 6h TTL. Ignored. |

## Refresh

```
python3 fetch_data.py            # regenerate data.js
python3 fetch_data.py --check    # what resolved, what did not, and why
python3 -m http.server 8081      # then open http://localhost:8081
```

Both feeds rate-limit this egress IP, so the fetcher paces itself, backs off with
jitter, and gives up on a throttled feed rather than deepening the block. Cached
quotes are reused, so a re-run after a few minutes picks up where it stopped.

## Decisions

- **Day 0 is the first session that could trade on the story**, not the calendar
  date of publication. `anchor` in `events.json` pins it where the reporting time
  is known: a Sunday release (Nvidia, 8 Nov 2026) prices on Monday; an
  after-close Friday resignation (HP, 6 Aug 2010) prices on Monday; a Labor Day
  announcement (Oracle, 6 Sep 2010) prices on Tuesday.
- **Adjusted closes drive returns; the feed is named per line.** Yahoo first, then
  Nasdaq's table endpoint, then Nasdaq's `chart` endpoint, each accepted only if it
  genuinely covers the window. Verified: the fallback is back-adjusted, since
  Hewlett-Packard's 2-for-1 of February 2011 leaves no step in its series. Any line
  with a 40-point one-session fall is refused as a split artefact instead of drawn.
- **A second, market-relative measure** matters as much as the raw one here. Nvidia
  was already ~25% below its 6 October record when the admission landed; Lockheed's
  six-month window contains the sequestration. Without the market control several
  of these lines just chart the tape.
- **Pre-market and after-hours figures from the press are not plotted**, only
  official session closes. Several of these stories broke after the close, so the
  damage printed the next morning and the reporting quotes both.
- **An unsettled session is labelled, never implied.** Where the build runs during
  trading, today's last point is marked with a dagger and described as a live price.
- **Cases are dropped rather than guessed.** Several famous-sounding episodes could
  not be dated from any document, and two were untrue outright; the method section
  names them and says how they were checked.

## Caveats on the analysis

A price move is not proof of a cause. Windows contain earnings, macro shocks and
other revelations about the same executive. Read the caveats on each row, and the
market-relative measure, before drawing a conclusion. This is analysis, not
investment advice.
