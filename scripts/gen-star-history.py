#!/usr/bin/env python3
"""Generate self-hosted GitHub star-history charts (light + dark SVG).

Replaces the api.star-history.com embed, whose backend lowercases repo
owners and serves an empty chart for this repo. Fetches stargazer
timestamps via `gh api` (works locally when authenticated and in CI via
GH_TOKEN) and renders two dependency-free SVGs tuned for GitHub's light
and dark README surfaces, selected with a <picture> element.

Usage: python3 scripts/gen-star-history.py <owner/repo> <out_prefix>
Writes <out_prefix>-light.svg and <out_prefix>-dark.svg
"""

import json
import subprocess
import sys
from datetime import datetime, timezone

W, H = 800, 400
MARGIN = {"l": 56, "r": 24, "t": 52, "b": 40}

THEMES = {
    "light": {
        "line": "#2563eb", "area_opacity": 0.10,
        "ink": "#1f2328", "muted": "#59636e", "grid": "#d1d9e0",
    },
    "dark": {
        "line": "#4493f8", "area_opacity": 0.14,
        "ink": "#e6edf3", "muted": "#8b949e", "grid": "#30363d",
    },
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fetch_star_dates(repo: str) -> list[datetime]:
    out = subprocess.run(
        ["gh", "api", f"repos/{repo}/stargazers", "--paginate",
         "-H", "Accept: application/vnd.github.star+json",
         "-q", ".[].starred_at"],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    dates = sorted(datetime.fromisoformat(d.replace("Z", "+00:00")) for d in out)
    if not dates:
        raise SystemExit(f"no stargazer data returned for {repo}")
    return dates


def build_series(dates: list[datetime]) -> list[tuple[datetime, int]]:
    # Cumulative count per day, then evenly sampled to <= 160 points.
    daily: dict[str, int] = {}
    for i, d in enumerate(dates, start=1):
        daily[d.strftime("%Y-%m-%d")] = i
    pts = [(datetime.fromisoformat(k).replace(tzinfo=timezone.utc), v)
           for k, v in sorted(daily.items())]
    if len(pts) > 160:
        step = (len(pts) - 1) / 159
        pts = [pts[round(i * step)] for i in range(160)]
    return pts


def nice_step(max_v: int) -> int:
    for step in (50, 100, 250, 500, 1000, 2000, 5000, 10000):
        if max_v / step <= 6:
            return step
    return 20000


def fmt_k(v: int) -> str:
    if v >= 1000:
        return f"{v/1000:g}K"
    return str(v)


def render(repo: str, pts: list[tuple[datetime, int]], theme: dict) -> str:
    x0, x1 = pts[0][0].timestamp(), pts[-1][0].timestamp()
    y_max_raw = pts[-1][1]
    step = nice_step(y_max_raw)
    y_max = ((y_max_raw // step) + 1) * step
    plot_w = W - MARGIN["l"] - MARGIN["r"]
    plot_h = H - MARGIN["t"] - MARGIN["b"]

    def sx(ts: float) -> float:
        return MARGIN["l"] + (ts - x0) / max(x1 - x0, 1) * plot_w

    def sy(v: float) -> float:
        return MARGIN["t"] + plot_h - v / y_max * plot_h

    line_d = " ".join(
        f"{'M' if i == 0 else 'L'}{sx(d.timestamp()):.1f},{sy(v):.1f}"
        for i, (d, v) in enumerate(pts)
    )
    base_y = sy(0)
    area_d = f"{line_d} L{sx(x1):.1f},{base_y:.1f} L{sx(x0):.1f},{base_y:.1f} Z"

    grid, ylabels = [], []
    for v in range(step, y_max + 1, step):
        y = sy(v)
        grid.append(f'<line x1="{MARGIN["l"]}" y1="{y:.1f}" x2="{W - MARGIN["r"]}" y2="{y:.1f}" '
                    f'stroke="{theme["grid"]}" stroke-width="1"/>')
        ylabels.append(f'<text x="{MARGIN["l"] - 8}" y="{y + 4:.1f}" text-anchor="end" '
                       f'fill="{theme["muted"]}" font-size="12">{fmt_k(v)}</text>')

    xlabels = []
    seen = set()
    for d, _ in pts:
        key = (d.year, d.month)
        if key in seen:
            continue
        seen.add(key)
        ts = datetime(d.year, d.month, 1, tzinfo=timezone.utc).timestamp()
        if ts < x0:
            ts = x0
        label = MONTHS[d.month - 1] + (f" '{str(d.year)[2:]}" if d.month == 1 or len(seen) == 1 else "")
        xlabels.append(f'<text x="{sx(ts):.1f}" y="{H - MARGIN["b"] + 20}" text-anchor="middle" '
                       f'fill="{theme["muted"]}" font-size="12">{label}</text>')

    end_x, end_y = sx(x1), sy(y_max_raw)
    label_anchor = "end"
    label_x = end_x - 10
    updated = pts[-1][0].strftime("%b %-d, %Y")

    font = "font-family=\"-apple-system,'Segoe UI',Helvetica,Arial,sans-serif\""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Cumulative GitHub stars for {repo}: {y_max_raw:,} as of {updated}">
  <g {font}>
    <text x="{MARGIN["l"]}" y="24" fill="{theme["ink"]}" font-size="15" font-weight="600">{repo} — GitHub stars</text>
    <text x="{W - MARGIN["r"] - 8}" y="24" text-anchor="end" fill="{theme["muted"]}" font-size="11">updated {updated}</text>
    {''.join(grid)}
    <line x1="{MARGIN["l"]}" y1="{base_y:.1f}" x2="{W - MARGIN["r"]}" y2="{base_y:.1f}" stroke="{theme["grid"]}" stroke-width="1"/>
    {''.join(ylabels)}
    {''.join(xlabels)}
    <path d="{area_d}" fill="{theme["line"]}" fill-opacity="{theme["area_opacity"]}" stroke="none"/>
    <path d="{line_d}" fill="none" stroke="{theme["line"]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="{end_x:.1f}" cy="{end_y:.1f}" r="4" fill="{theme["line"]}"/>
    <text x="{label_x:.1f}" y="{end_y - 10:.1f}" text-anchor="{label_anchor}" fill="{theme["ink"]}" font-size="13" font-weight="600">{y_max_raw:,} ★</text>
  </g>
</svg>
'''


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    repo, prefix = sys.argv[1], sys.argv[2]
    pts = build_series(fetch_star_dates(repo))
    for mode, theme in THEMES.items():
        path = f"{prefix}-{mode}.svg"
        with open(path, "w") as f:
            f.write(render(repo, pts, theme))
        print(f"wrote {path} ({pts[-1][1]} stars, {len(pts)} points)")


if __name__ == "__main__":
    main()
