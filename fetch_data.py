#!/usr/bin/env python3
"""Build data.js from events.json.

For each disclosed CEO-affair event we pull daily closes and index them to the last
close BEFORE the disclosure date, so every line starts at zero on the day the story
was first tradeable. The same window of market closes is indexed the same way, which
lets the page separate the story from the tape.

Usage:  python3 fetch_data.py            # write data.js
        python3 fetch_data.py --check    # report coverage, write nothing
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
TRADING_HORIZON = 126       # trading days drawn per line (about six months)
BENCH = "^GSPC"
BENCH_ETF = "SPY"             # stand-in when the index feed is unavailable or throttled
CACHE = ROOT / ".cache"
MIN_GAP = 4.0               # seconds between outbound requests; Yahoo rate-limits bursts
NASDAQ_HEADERS = {"Accept": "application/json", "Origin": "https://www.nasdaq.com",
                  "Referer": "https://www.nasdaq.com/"}
_last_request = 0.0


class RateLimited(RuntimeError):
    """The egress IP is throttled. Keep asking and the block gets longer, so stop."""


_throttle_hits = 0
THROTTLE_LIMIT = 2          # consecutive 429s across the run before giving up
COOLDOWN = CACHE / "yahoo-cooldown"
COOLDOWN_S = 300            # after a throttle, leave Yahoo alone for this long


def yahoo_throttled() -> bool:
    try:
        return time.time() < float(COOLDOWN.read_text())
    except (OSError, ValueError):
        return False


def note_throttle() -> None:
    CACHE.mkdir(exist_ok=True)
    COOLDOWN.write_text(str(time.time() + COOLDOWN_S))


def http_json(url: str, headers: dict[str, str] | None = None):
    """GET JSON through curl. Yahoo 429s this shared egress IP in bursts and the proxy
    intermittently refuses urllib's CONNECT, so: curl, pacing, jittered backoff, and a
    circuit breaker that quits the run rather than deepening the block."""
    global _last_request, _throttle_hits
    CACHE.mkdir(exist_ok=True)
    key = CACHE / (urllib.parse.quote(url, safe="") + ".json")
    if key.exists() and time.time() - key.stat().st_mtime < 6 * 3600:
        return json.loads(key.read_text())
    last = None
    for attempt in range(4):
        wait = _last_request + MIN_GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        probe = url if attempt % 2 == 0 else url.replace("query1.finance", "query2.finance")
        cmd = ["curl", "-sS", "-m", "40", "--compressed",
               "-H", f"User-Agent: {UA['User-Agent']}",
               "-H", "Accept: application/json,text/plain,*/*"]
        for k, v in (headers or {}).items():
            cmd += ["-H", f"{k}: {v}"]
        cmd += ["-w", "\n%{http_code}", probe]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        _last_request = time.time()
        body, _, code = proc.stdout.rpartition("\n")
        if proc.returncode == 0 and code == "200":
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                last = f"unparsable body ({body[:60]!r})"
            else:
                _throttle_hits = 0
                key.write_text(body)
                return data
        else:
            last = f"curl {proc.returncode}/HTTP {code} {proc.stderr.strip()[:70]}"
            if code == "429":
                _throttle_hits += 1
                if _throttle_hits >= THROTTLE_LIMIT:
                    note_throttle()
                    raise RateLimited(
                        f"throttled after {_throttle_hits} consecutive 429s; Yahoo is left alone "
                        f"for {COOLDOWN_S // 60} minutes \u2014 re-run then, cached quotes are reused")
        time.sleep(min(15.0, 3.0 * 2 ** attempt) + random.uniform(0, 2))
    raise RuntimeError(f"{url}: {last}")


def daily(symbol: str) -> tuple[dict[str, float], dict[str, float], str]:
    """(adjusted, raw) close per calendar date plus quote currency.

    Returns are computed from `adjclose`: a split inside a window would otherwise
    print as a 90%+ crash (NVDA 1:10 in 2024, GOOGL/AMZN 20:1 in 2022, etc.).
    """
    now = datetime.now(timezone.utc)
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        f"{urllib.parse.quote(symbol)}"
        f"?period1={int(datetime(1998, 1, 1, tzinfo=timezone.utc).timestamp())}"
        f"&period2={int(now.timestamp())}&interval=1d"
    )
    try:
        chart = http_json(url)["chart"]
        if chart.get("error"):
            raise RuntimeError(f"{symbol}: {chart['error']}")
        result = (chart.get("result") or [None])[0]
        if not result:
            raise RuntimeError(f"{symbol}: no result")
        currency = result.get("meta", {}).get("currency", "USD")
        stamps = result.get("timestamp") or []
        raw = (result["indicators"]["quote"][0].get("close") or []) + [None] * len(stamps)
        adj = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose")
        adj = (adj if adj else raw) + [None] * len(stamps)
    except (TypeError, KeyError, IndexError) as exc:
        # One malformed response must not abort the other nine tickers.
        raise RuntimeError(f"{symbol}: malformed yahoo payload ({exc!r})") from exc
    raws: dict[str, float] = {}
    adjs: dict[str, float] = {}
    for ts, r, a in zip(stamps, raw, adj):
        if r is None:
            continue
        day = datetime.fromtimestamp(ts, timezone.utc).date().isoformat()
        raws[day] = float(r)
        adjs[day] = float(a) if a is not None else float(r)
    if not raws:
        raise RuntimeError(f"{symbol}: no closes returned")
    return adjs, raws, currency


def daily_nasdaq(symbol: str, assetclass: str = "stocks",
                 since_days: int = 500) -> tuple[dict[str, float], dict[str, float], str]:
    """Fallback feed. Nasdaq's history endpoint serves roughly the trailing year,
    back-adjusted for splits like the chart endpoint. Tried ahead of the deep one for
    recent windows because it is cheaper; the caller records which feed produced each
    line so the page can say where a line came from.
    """
    et = datetime.now(timezone.utc)
    url = (
        "https://api.nasdaq.com/api/quote/"
        f"{urllib.parse.quote(symbol)}/historical?assetclass={assetclass}"
        f"&fromdate={(et - timedelta(days=since_days)).strftime('%Y-%m-%d')}"
        f"&todate={et.strftime('%Y-%m-%d')}&limit=1000"
    )
    data = http_json(url, headers=NASDAQ_HEADERS).get("data")
    if not data or not data.get("tradesTable"):
        raise RuntimeError(f"{symbol}: nasdaq returned no table")
    rows: dict[str, float] = {}
    for r in data["tradesTable"]["rows"]:
        try:
            d = datetime.strptime(r["date"], "%m/%d/%Y").date().isoformat()
            rows[d] = float(r["close"].replace("$", "").replace(",", ""))
        except (KeyError, ValueError):
            continue
    if not rows:
        raise RuntimeError(f"{symbol}: nasdaq rows unparsable")
    return dict(rows), dict(rows), "USD"


def daily_nasdaq_chart(symbol: str, assetclass: str, start: str, end: str) -> dict[str, float]:
    """Closes over an explicit window from Nasdaq's chart endpoint, which reaches back
    decades where its table endpoint only covers the trailing year.

    These are split-adjusted, verified against Hewlett-Packard's 2-for-1 of 11 February
    2011: the series steps 22.64 to 22.50 with no discontinuity, and carries the
    tell-tale long decimals of a back-adjusted series. The caller still refuses any
    line with a 40-point one-session fall, which is what an unhandled split looks like.
    """
    url = (
        "https://api.nasdaq.com/api/quote/"
        f"{urllib.parse.quote(symbol)}/chart?assetclass={assetclass}"
        f"&fromdate={start}&todate={end}"
    )
    data = http_json(url, headers=NASDAQ_HEADERS).get("data") or {}
    rows: dict[str, float] = {}
    for r in data.get("chart") or []:
        z = r.get("z") or {}
        try:
            d = datetime.strptime(z["dateTime"], "%m/%d/%Y").date().isoformat()
            rows[d] = float(str(z["close"]).replace("$", "").replace(",", ""))
        except (KeyError, TypeError, ValueError):
            continue
    if not rows:
        raise RuntimeError(f"{symbol}: nasdaq chart empty for {start}..{end}")
    return rows

def live_quote(symbol: str, assetclass: str = "stocks") -> tuple[float, str, float | None]:
    """(last price, timestamp text, previous close) for the session in progress."""
    q = urllib.parse.quote(symbol)
    info = (http_json(f"https://api.nasdaq.com/api/quote/{q}/info?assetclass={assetclass}",
                      headers=NASDAQ_HEADERS).get("data") or {}).get("primaryData") or {}
    price = str(info.get("lastSalePrice") or "").replace("$", "").replace(",", "")
    if not price:
        raise RuntimeError(f"{symbol}: no live price")
    summ = (http_json(f"https://api.nasdaq.com/api/quote/{q}/summary?assetclass={assetclass}",
                      headers=NASDAQ_HEADERS).get("data") or {}).get("summaryData") or {}
    prev_raw = summ.get("PreviousClose") if isinstance(summ, dict) else None
    if isinstance(prev_raw, dict):          # NYSE listings wrap values as {label, value}
        prev_raw = prev_raw.get("value")
    prev = str(prev_raw or "").replace("$", "").replace(",", "")
    return float(price), info.get("lastTradeTimestamp") or "", (float(prev) if prev else None)


def _covers(rows: dict[str, float], start: str | None, end: str | None) -> bool:
    """Does this series actually span the window the caller needs? The Nasdaq table
    endpoint answers happily with a year of data when asked for 2005, so coverage
    has to be checked rather than assumed.
    """
    if not rows:
        return False
    if not start or not end:
        return True
    ds = sorted(rows)
    # Tight at the end: a benchmark that stops a week short would otherwise be
    # forward-filled across the tail and the excess series would be fiction.
    return (_dt(ds[0]) <= _dt(start) + timedelta(days=10)
            and _dt(ds[-1]) >= _dt(end) - timedelta(days=4))


def fetch_symbol(sym: str, window: tuple[str, str] | None = None,
                 allow_yahoo: bool = True) -> tuple[dict[str, float], dict[str, float], str, str, bool]:
    """(adjusted, raw, currency, feed, split_adjusted) for one ticker.

    Yahoo first: it returns an adjusted and an as-traded series, and its adjusted
    series is dividend-adjusted too. The Nasdaq endpoints are split-adjusted only
    (verified: HP's 2-for-1 of Feb 2011 leaves no step; Boeing 2005 matches the
    printed $58.30 exactly, so no dividend haircut). The point-fall gate in main()
    is the backstop if a feed ever hands back raw prices. Each candidate is accepted
    only if it actually covers the window asked for.
    """
    start, end = window or (None, None)
    if allow_yahoo:
        try:
            adj, raw, ccy = daily(sym)
            if _covers(adj, start, end):
                return adj, raw, ccy, "yahoo", True
            print(f"  yahoo window short for {sym}", file=sys.stderr)
        except RateLimited:
            raise                                 # never pound a throttled feed
        except RuntimeError as exc:
            print(f"  yahoo failed {sym:8s} {str(exc)[-70:]}", file=sys.stderr)
    for acl in ("stocks", "etf"):
        try:
            adj, raw, ccy = daily_nasdaq(sym, acl)
            if _covers(adj, start, end):
                return adj, raw, ccy, f"nasdaq:{acl}", True
        except RuntimeError:
            continue
    for acl in ("stocks", "etf"):
        try:
            raw = daily_nasdaq_chart(sym, acl, start, end)
            if _covers(raw, start, end):
                return dict(raw), dict(raw), "USD", f"nasdaq-chart:{acl}", True
        except RuntimeError:
            continue
    raise RuntimeError(f"{sym}: no feed covered {start}..{end}")


def indexed(rows: dict[str, float], days: list[str], anchor: str, base: str,
            horizon: int) -> tuple[list[float], list[str]]:
    """Percent change from the `base` session, over the sessions from `anchor` on."""
    if base not in rows:
        raise RuntimeError(f"no base close on {base}")
    window = [d for d in days if d >= anchor][:horizon]
    if not window:
        raise RuntimeError(f"no sessions at or after {anchor}")
    return [rows[d] / rows[base] * 100 - 100 for d in window], window


def main() -> int:
    check_only = "--check" in sys.argv
    spec = json.loads((ROOT / "events.json").read_text())

    quotes: dict[str, dict[str, float]] = {}     # split/dividend adjusted: drives returns
    raws: dict[str, dict[str, float]] = {}       # as traded: drives the displayed price
    currency: dict[str, str] = {}
    feed: dict[str, str] = {}
    adjflag: dict[str, bool] = {}
    failed: list[str] = []
    yahoo_off = False        # once the IP is throttled, stop knocking and use the fallback

    need: dict[str, tuple[str, str]] = {}
    for e in spec["events"]:
        first = e["disclosed"]
        last = e.get("anchor") or e["disclosed"]
        lo, hi = need.get(e["ticker"], (first, last))
        need[e["ticker"]] = (min(lo, first), max(hi, last))

    def window_for(sym: str, all_days: tuple[str, str] | None = None) -> tuple[str, str]:
        lo, hi = all_days or need[sym]
        start = (_dt(lo) - timedelta(days=20)).strftime("%Y-%m-%d")
        # 126 sessions is about 183 calendar days in a clean year; ask for far more so
        # a halt, an outage or an exchange holiday truncates a line rather than
        # silently shortening it.
        end = min(_dt(hi) + timedelta(days=300), datetime.now(timezone.utc)).strftime("%Y-%m-%d")
        return start, end

    for sym in sorted(need):
        try:
            quotes[sym], raws[sym], currency[sym], feed[sym], adjflag[sym] = \
                fetch_symbol(sym, window_for(sym), not yahoo_off)
            print(f"  pulled {sym:8s} {len(quotes[sym]):5d} sessions ({feed[sym]})", file=sys.stderr)
        except RateLimited as exc:
            yahoo_off = True
            print(f"  YAHOO THROTTLED: {exc}", file=sys.stderr)
            try:
                quotes[sym], raws[sym], currency[sym], feed[sym], adjflag[sym] = \
                    fetch_symbol(sym, window_for(sym), False)
                print(f"  pulled {sym:8s} {len(quotes[sym]):5d} sessions ({feed[sym]})", file=sys.stderr)
            except RuntimeError as exc2:
                failed.append(sym)
                print(f"  FAILED {sym:8s} {str(exc2)[-70:]}", file=sys.stderr)
        except RuntimeError as exc:
            failed.append(sym)
            print(f"  FAILED {sym:8s} {str(exc)[-70:]}", file=sys.stderr)

    all_lo = min(lo for lo, _ in need.values())
    all_hi = max(hi for _, hi in need.values())
    bench, bench_label = None, None
    for cand, label in ((BENCH, "the S&P 500"), (BENCH_ETF, "the SPY exchange-traded fund")):
        try:
            quotes[cand], raws[cand], currency[cand], feed[cand], adjflag[cand] = \
                fetch_symbol(cand, window_for(None, (all_lo, all_hi)), not yahoo_off)
            bench, bench_label = cand, f"{label} ({cand}, {feed[cand]})"
            print(f"  pulled {cand:8s} {len(quotes[cand]):5d} sessions ({feed[cand]})", file=sys.stderr)
            break
        except RateLimited as exc:
            yahoo_off = True
            print(f"  YAHOO THROTTLED: {exc}", file=sys.stderr)
        except RuntimeError as exc:
            print(f"  benchmark {cand} out: {str(exc)[-60:]}", file=sys.stderr)
    if not bench:
        print("  no benchmark: the versus-market series will be blank", file=sys.stderr)

    # A session still in progress is not a close, and pre-market is not a session.
    # Gate on real New York trading hours (ZoneInfo, so DST cannot shift the edge by
    # an hour), and trust the quote's own timestamp over our clock before believing it.
    try:
        from zoneinfo import ZoneInfo
        ny = datetime.now(ZoneInfo("America/New_York"))
    except Exception:                                    # noqa: BLE001 - tz data missing
        ny = datetime.now(timezone.utc) - timedelta(hours=5)
        print("  zoneinfo unavailable; using a fixed UTC-5 for the trading window",
              file=sys.stderr)
    today = ny.strftime("%Y-%m-%d")
    trading = ny.weekday() < 5 and (ny.hour, ny.minute) >= (9, 30) and ny.hour < 16
    live_stamp = None
    if trading:
        for sym in sorted(quotes):
            ds = sorted(quotes[sym])
            if not ds or ds[-1] >= today:
                continue
            # Only worth asking where the series ought to reach today: a line that
            # ends in 2019 has no business gaining a 2026 point.
            if (_dt(today) - _dt(ds[-1])).days > 7:
                continue
            try:
                px, stamp, prev = live_quote(sym, "etf" if sym == bench else "stocks")
            except Exception as exc:                       # noqa: BLE001 - best effort
                print(f"  live {sym}: {str(exc)[:60]}", file=sys.stderr)
                continue
            # The quote must be stamped today, else it is yesterday's close or a
            # pre-market print being dressed up as a new session.
            stamp_day = None
            if stamp:
                try:
                    head = " ".join(stamp.replace(" at ", " ").split()[:3])
                    stamp_day = datetime.strptime(head, "%b %d, %Y").strftime("%Y-%m-%d")
                except ValueError:
                    stamp_day = None
            if stamp and stamp_day != today:
                print(f"  live {sym}: quote stamp {stamp!r} is not {today}; skipped",
                      file=sys.stderr)
                continue
            if prev is not None and abs(prev - quotes[sym][ds[-1]]) / quotes[sym][ds[-1]] > 0.01:
                print(f"  live {sym}: previous close {prev} disagrees with {ds[-1]} "
                      f"({quotes[sym][ds[-1]]}); skipped", file=sys.stderr)
                continue
            if px == quotes[sym][ds[-1]]:
                print(f"  live {sym}: last price equals the previous close; not a session",
                      file=sys.stderr)
                continue
            quotes[sym][today] = px
            raws[sym][today] = px
            live_stamp = stamp
            print(f"  live  {sym:8s} {today} {px} ({stamp})", file=sys.stderr)
    bench_days = sorted(quotes[bench]) if bench else []
    events, problems = [], []
    for ev in spec["events"]:
        sym = ev["ticker"]
        if sym not in quotes:
            problems.append(f"{ev['id']}: no quote data fetched for {sym}")
            continue
        rows = quotes[sym]
        days = sorted(rows)
        # Day 0 is the first session that could trade on the story: an explicit
        # `anchor` when research pins the publication time, else the disclosure
        # date itself or the next session the stock actually traded.
        anchor = ev.get("anchor") or next((d for d in days if d >= ev["disclosed"]), None)
        if anchor not in rows:
            nearest = min(days, key=lambda d: abs((_dt(d) - _dt(anchor or ev["disclosed"])).days))
            problems.append(f"{ev['id']}: {sym} does not trade on {anchor} (nearest {nearest})")
            continue
        prior = [d for d in days if d < anchor]
        if not prior:
            problems.append(f"{ev['id']}: no session before {anchor} for {sym}")
            continue
        base = prior[-1]
        try:
            pct, window = indexed(rows, days, anchor, base, TRADING_HORIZON)
        except RuntimeError as exc:
            problems.append(f"{ev['id']}: {exc}")
            continue
        # Match the benchmark to the stock's own calendar: halts and regional
        # holidays mean the two series need not share sessions.
        before_mkt = [d for d in bench_days if d < anchor]
        if before_mkt:
            mkt = [_lookup(bench_days, quotes[bench], d, before_mkt[-1]) for d in window]
        else:
            mkt = [None] * len(window)
            if bench:
                problems.append(f"{ev['id']}: no benchmark session before {anchor}")
        # Sanity gate: nothing in this sample has ever fallen 25 points in one
        # session (the worst is Nvidia's -9.3 on 5 Nov 2026), while a 3-for-2 split
        # on an unadjusted feed shows as -33 and a 5-for-4 as -20. -40 would let both
        # through and the chart would invent a crash, so the bar sits below them.
        steps = [pct[i] - pct[i - 1] for i in range(1, len(pct))]
        if steps and min(steps) < -25:
            problems.append(f"{ev['id']}: {sym} shows a {min(steps):.1f} point one-session fall, "
                            f"which is a split artefact rather than a crash; not plotted")
            continue
        events.append({
            **ev,
            "baseSession": base,
            "baseClose": round(raws[sym][base], 4),
            "currency": currency[sym],
            "feed": feed.get(sym, "unknown"),
            "splitAdjusted": adjflag.get(sym, True),
            "dates": window,
            "pct": [round(v, 3) for v in pct],
            "mkt": [None if v is None else round(v, 3) for v in mkt],
            "excess": [None if m is None else round(p - m, 3) for p, m in zip(pct, mkt)],
            "prices": [round(raws[sym][d], 4) for d in window],
        })

    for p in problems:
        print("UNRESOLVED: " + p, file=sys.stderr)
    if check_only:
        for e in events:
            trough = min(e["pct"])
            xs = [v for v in e["excess"] if v is not None]
            print(f"{e['id']:12s} {e['ticker']:7s} {e['disclosed']} n={len(e['pct']):3d} "
                  f"d1={e['pct'][1] if len(e['pct']) > 1 else float('nan'):+7.2f}% "
                  f"trough={trough:+7.2f}% on "
                  f"{e['dates'][e['pct'].index(trough)]} "
                  f"minExcess={(min(xs) if xs else float('nan')):+7.2f}%")
        return 1 if problems else 0

    if not events:
        print("nothing resolved; data.js not written", file=sys.stderr)
        return 1
    # Write what resolved and name what did not, so a row can never disappear
    # silently from a chart that claims to show every case.
    if len(events) < len(spec["events"]):
        print(f"  {len(events)} of {len(spec['events'])} rows resolved; the rest are listed "
              f"under 'Not plotted in this build'", file=sys.stderr)
    as_of = max(e["dates"][-1] for e in events)
    # A session is still trading if it is today's date in New York before the
    # 16:00 close: its last value is a live print, not a settled close.
    et = datetime.now(timezone(timedelta(hours=-5)))
    live = as_of if (as_of == et.strftime("%Y-%m-%d")
                     and et.hour < 16 and et.weekday() < 5) else None
    out = {
        "meta": {
            "builtOn": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "asOfDate": as_of,
            "asOfWeekday": datetime.strptime(as_of, "%Y-%m-%d").strftime("%A"),
            "liveDate": live,
            "liveStamp": live_stamp if live else None,
            "horizon": TRADING_HORIZON,
            "benchmark": bench_label or "none available",
            "feeds": {k: v for k, v in sorted(feed.items()) if k != bench},
            "unresolved": problems,
        },
        "events": events,
    }
    body = "window.AFFAIRS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "data.js").write_text(body)
    print(f"data.js: {len(events)} events, {len(body)/1024:.0f} KiB, as of {as_of}", file=sys.stderr)
    return 0


def _dt(iso: str) -> datetime:
    return datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def _lookup(bench_days: list[str], bench_rows: dict[str, float], day: str, base: str,
            max_fill_days: int = 5):
    """Benchmark percent change for a stock session.

    Forward-fill is for the ordinary gaps between two calendars (a regional holiday,
    a halt), so it is capped at a few days. Unlimited fill is how a benchmark that
    stopped trading weeks ago would keep producing plausible-looking numbers.
    """
    if day in bench_rows:
        return bench_rows[day] / bench_rows[base] * 100 - 100
    earlier = [d for d in bench_days if d <= day]
    if not earlier or (_dt(day) - _dt(earlier[-1])).days > max_fill_days:
        return None
    return bench_rows[earlier[-1]] / bench_rows[base] * 100 - 100


if __name__ == "__main__":
    sys.exit(main())
