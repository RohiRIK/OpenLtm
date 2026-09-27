#!/usr/bin/env python3
"""
generate-brand-assets.py — build OpenLTM catalog artwork.

The brand language (see assets/openltm-banner.jpeg) is a glowing constellation:
deep indigo ground, nodes running amber on the left through magenta on the
right, thin luminous edges. These assets are generated as SVG so gradients,
blur-based glow, and type all rasterise cleanly, then converted to PNG with
rsvg-convert.

Outputs:
  assets/icon.png             512x512  — plugin catalog icon (ClawHub/OpenClaw)
  assets/catalog-banner.png  1200x600  — 2:1 catalog banner (Hermes catalog)
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

# Brand palette lifted from the README banner.
AMBER = (251, 191, 36)
VIOLET = (168, 85, 247)      # brand midpoint: amber -> violet -> magenta
MAGENTA = (232, 121, 249)
GROUND_A = (23, 16, 46)     # deep indigo
GROUND_B = (10, 9, 22)      # near-black plum
INK = (255, 255, 255)


def rgb(c: tuple[int, int, int], alpha: float = 1.0) -> str:
    return f"rgba({c[0]},{c[1]},{c[2]},{alpha:g})"


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def constellation(cx: float, cy: float, spread: float, seed: int,
                  core_r: float, sat_r: float, count: int = 7) -> list[dict]:
    """Deterministic pseudo-random satellites; no RNG so builds are reproducible."""
    nodes = [{"x": cx, "y": cy, "r": core_r, "hub": True}]
    golden = math.pi * (3 - math.sqrt(5))  # phyllotaxis: even, non-gridly spacing
    for i in range(count):
        a = i * golden + seed * 0.37
        # radius varies so the web does not look mechanical
        rr = spread * (0.72 + 0.28 * ((i * 7 + seed * 3) % 5) / 4)
        jitter = math.sin((i + 1) * 2.1 + seed) * 0.10
        x = cx + math.cos(a) * rr
        y = cy + math.sin(a) * rr * (0.86 + jitter)
        size = sat_r * (0.62 + 0.55 * ((i * 5 + seed) % 4) / 3)
        nodes.append({"x": x, "y": y, "r": size, "hub": False})
    return nodes


def t_for_x(x: float, x0: float, x1: float) -> float:
    return (x - x0) / max(1e-6, (x1 - x0))


def brand_ramp(t: float) -> tuple[int, int, int]:
    """Amber -> violet -> magenta. Interpolating amber straight to magenta in RGB
    passes through a muddy salmon at the midpoint, which is not the brand."""
    t = max(0.0, min(1.0, t))
    # Violet sits at 0.62 so the left of the frame stays amber like the hero,
    # instead of drifting to rose a third of the way across.
    return mix(AMBER, VIOLET, t / 0.62) if t <= 0.62 else mix(VIOLET, MAGENTA, (t - 0.62) / 0.38)


def svg_icon() -> str:
    S = 512
    cx, cy = 256, 248
    nodes = constellation(cx, cy, spread=168, seed=2, core_r=34, sat_r=20)
    xs = [n["x"] for n in nodes]
    x0, x1 = min(xs) - 40, max(xs) + 40

    edges: list[str] = []
    sats = nodes[1:]
    # spokes to the core
    for s in sats:
        edges.append(f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{s["x"]:.1f}" y2="{s["y"]:.1f}"/>')
    # chords between neighbours in the ring
    for i, a in enumerate(sats):
        b = sats[(i + 1) % len(sats)]
        edges.append(f'<line x1="{a["x"]:.1f}" y1="{a["y"]:.1f}" x2="{b["x"]:.1f}" y2="{b["y"]:.1f}"/>')
    # a couple of skip chords for density
    for i in (0, 3):
        a, b = sats[i], sats[(i + 3) % len(sats)]
        edges.append(f'<line x1="{a["x"]:.1f}" y1="{a["y"]:.1f}" x2="{b["x"]:.1f}" y2="{b["y"]:.1f}"/>')

    edge_svg = "\n    ".join(edges)

    glow_nodes, core_nodes, specks = [], [], []
    for n in nodes:
        col = brand_ramp(t_for_x(n["x"], x0, x1))
        common = f'cx="{n["x"]:.1f}" cy="{n["y"]:.1f}" r="{n["r"]:.1f}"'
        glow_nodes.append(f'<circle {common} fill="{rgb(col)}"/>')
        if n["hub"]:
            core_nodes.append(f'<circle {common} fill="{rgb(col)}"/>')
            # white-hot centre, the way the brand hero's brightest node reads
            specks.append(
                f'<circle cx="{n["x"]:.1f}" cy="{n["y"] - n["r"] * 0.22:.1f}" '
                f'r="{n["r"] * 0.42:.1f}" fill="#fffdf2" opacity="0.85"/>'
            )
        else:
            core_nodes.append(f'<circle {common} fill="{rgb(col)}"/>')
            specks.append(
                f'<circle cx="{n["x"] - n["r"] * 0.2:.1f}" cy="{n["y"] - n["r"] * 0.24:.1f}" '
                f'r="{n["r"] * 0.3:.1f}" fill="#fffaf0" opacity="0.7"/>'
            )

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{rgb(GROUND_A)}"/>
      <stop offset="1" stop-color="{rgb(GROUND_B)}"/>
    </linearGradient>
    <linearGradient id="nodeGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{rgb(AMBER)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA)}"/>
    </linearGradient>
    <radialGradient id="coreGrad" cx="0.38" cy="0.32" r="0.85">
      <stop offset="0" stop-color="#fff6d8"/>
      <stop offset="0.45" stop-color="{rgb(AMBER)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA)}"/>
    </radialGradient>
    <radialGradient id="hazeA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{rgb(AMBER, 0.30)}"/>
      <stop offset="1" stop-color="{rgb(AMBER, 0)}"/>
    </radialGradient>
    <radialGradient id="hazeB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{rgb(MAGENTA, 0.28)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA, 0)}"/>
    </radialGradient>
    <filter id="soft" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="2.6"/>
    </filter>
    <filter id="soft2" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="0.7"/>
    </filter>
    <!-- Everything is clipped to the rounded square so the ambient haze cannot
         leak past the corners (which produced bright wedges in v1). -->
    <clipPath id="squircle">
      <rect width="{S}" height="{S}" rx="112" ry="112"/>
    </clipPath>
  </defs>

  <g clip-path="url(#squircle)">
  <rect width="{S}" height="{S}" fill="url(#bg)"/>
  <ellipse cx="140" cy="160" rx="260" ry="240" fill="url(#hazeA)"/>
  <ellipse cx="382" cy="352" rx="260" ry="240" fill="url(#hazeB)"/>

  <g stroke="{rgb(INK, 0.26)}" stroke-width="1.7" stroke-linecap="round">
    {edge_svg}
  </g>
  <g stroke="{rgb(MAGENTA, 0.34)}" stroke-width="2.6" filter="url(#soft)" opacity="0.6">
    {edge_svg}
  </g>

  <g filter="url(#soft)" opacity="0.7">
    {"".join(glow_nodes)}
  </g>
  <g filter="url(#soft2)">
    {"".join(core_nodes)}
  </g>
  {"".join(specks)}
  </g>
</svg>
"""


def svg_banner() -> str:
    W, H = 1200, 600
    nodes_l = constellation(230, 300, spread=190, seed=5, core_r=24, sat_r=14, count=8)
    nodes_r = constellation(1000, 300, spread=185, seed=9, core_r=22, sat_r=13, count=7)

    def web(nodes: list[dict], gx0: float, gx1: float) -> tuple[str, str, str]:
        cx = sum(n["x"] for n in nodes) / len(nodes)
        cy = sum(n["y"] for n in nodes) / len(nodes)
        sats = nodes[1:]
        e = []
        for s in sats:
            e.append(f'<line x1="{cx:.1f}" y1="{cy:.1f}" x2="{s["x"]:.1f}" y2="{s["y"]:.1f}"/>')
        for i, a in enumerate(sats):
            b = sats[(i + 1) % len(sats)]
            e.append(f'<line x1="{a["x"]:.1f}" y1="{a["y"]:.1f}" x2="{b["x"]:.1f}" y2="{b["y"]:.1f}"/>')
        for i in (0, 2, 4):
            a, b = sats[i], sats[(i + 3) % len(sats)]
            e.append(f'<line x1="{a["x"]:.1f}" y1="{a["y"]:.1f}" x2="{b["x"]:.1f}" y2="{b["y"]:.1f}"/>')
        g, c, sp = [], [], []
        for n in nodes:
            col = brand_ramp(t_for_x(n["x"], gx0, gx1))
            g.append(f'<circle cx="{n["x"]:.1f}" cy="{n["y"]:.1f}" r="{n["r"]:.1f}" fill="{rgb(col)}"/>')
            c.append(f'<circle cx="{n["x"]:.1f}" cy="{n["y"]:.1f}" r="{n["r"]:.1f}" fill="{rgb(col)}"/>')
            rr = n["r"] * (0.42 if n["hub"] else 0.30)
            sp.append(
                f'<circle cx="{n["x"] - n["r"] * 0.2:.1f}" cy="{n["y"] - n["r"] * 0.24:.1f}" '
                f'r="{rr:.1f}" fill="#fffdf2" opacity="{0.85 if n["hub"] else 0.7}"/>'
            )
        return "\n      ".join(e), "".join(g), "".join(c) + "".join(sp)

    el, gl, cl = web(nodes_l, 0, 600)
    er, gr, cr = web(nodes_r, 600, 1200)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{rgb(GROUND_A)}"/>
      <stop offset="0.55" stop-color="#120c26"/>
      <stop offset="1" stop-color="{rgb(GROUND_B)}"/>
    </linearGradient>
    <linearGradient id="nodeGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{rgb(AMBER)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA)}"/>
    </linearGradient>
    <radialGradient id="coreGrad" cx="0.38" cy="0.32" r="0.85">
      <stop offset="0" stop-color="#fff6d8"/>
      <stop offset="0.45" stop-color="{rgb(AMBER)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA)}"/>
    </radialGradient>
    <radialGradient id="hazeA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{rgb(AMBER, 0.26)}"/>
      <stop offset="1" stop-color="{rgb(AMBER, 0)}"/>
    </radialGradient>
    <radialGradient id="hazeB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="{rgb(MAGENTA, 0.24)}"/>
      <stop offset="1" stop-color="{rgb(MAGENTA, 0)}"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.4"/>
    </filter>
    <filter id="soft2" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
    <!-- Scrim keeps the wordmark legible where it crosses the graph. -->
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{rgb(GROUND_B, 0)}"/>
      <stop offset="0.16" stop-color="{rgb(GROUND_B, 0.82)}"/>
      <stop offset="0.84" stop-color="{rgb(GROUND_B, 0.82)}"/>
      <stop offset="1" stop-color="{rgb(GROUND_B, 0)}"/>
    </linearGradient>
  </defs>

  <rect width="{W}" height="{H}" fill="url(#bg)"/>
  <ellipse cx="150" cy="300" rx="440" ry="400" fill="url(#hazeA)"/>
  <ellipse cx="1060" cy="300" rx="440" ry="400" fill="url(#hazeB)"/>

  <!-- One gradient across the whole canvas, so the left stays amber and the
       right stays magenta, matching the README hero. -->
  <g stroke="{rgb(INK, 0.20)}" stroke-width="1.4" stroke-linecap="round">
    {el}{er}
  </g>
  <g stroke="{rgb(MAGENTA, 0.22)}" stroke-width="2.4" filter="url(#soft)" opacity="0.6">
    {er}
  </g>
  <g filter="url(#soft)" opacity="0.8">{gl}{gr}</g>
  <g filter="url(#soft2)">{cl}{cr}</g>

  <rect x="240" y="0" width="720" height="{H}" fill="url(#scrim)"/>

  <g font-family="Liberation Sans, DejaVu Sans, sans-serif">
    <text x="600" y="292" font-size="104" font-weight="bold" fill="{rgb(INK)}"
          text-anchor="middle" letter-spacing="-1.5">OpenLTM</text>
    <text x="600" y="344" font-size="30" font-weight="normal" fill="{rgb(INK, 0.86)}"
          text-anchor="middle">Long-term memory for AI coding agents</text>
    <text x="600" y="390" font-size="20" font-weight="normal" fill="{rgb(INK, 0.72)}"
          text-anchor="middle" letter-spacing="1.6">FTS5 SEARCH · VECTOR RECALL · DECAY · MEMORY GRAPH</text>
  </g>
</svg>
"""


def render(svg: str, out_png: Path, width: int, height: int) -> None:
    svg_path = out_png.with_suffix(".svg")
    svg_path.write_text(svg, encoding="utf-8")
    subprocess.run(
        ["rsvg-convert", "-w", str(width), "-h", str(height),
         "-o", str(out_png), str(svg_path)],
        check=True,
    )
    size = out_png.stat().st_size
    print(f"  {out_png.relative_to(ROOT)}  {width}x{height}  {size / 1024:.1f} KiB")


if __name__ == "__main__":
    print("Generating brand assets")
    render(svg_icon(), ASSETS / "icon.png", 512, 512)
    render(svg_banner(), ASSETS / "catalog-banner.png", 1200, 600)
