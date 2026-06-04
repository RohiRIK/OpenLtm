---
name: OpenLTM Graph App
description: A dark studio production aesthetic inspired by ORYZO AI — warm dark canvas, flat surfaces, no shadows or blurs.
colors:
  studioBlack: "#100904"
  warmCream: "#ffedd7"
  corkShadow: "#40372e"
  darkCork: "#382416"
  burntSienna: "#dc5000"
  greyBrown: "#6c5f51"
typography:
  family: "Plus Jakarta Sans, sans-serif"
  lineHeight: "0.90-1.33"
  letterSpacing: "normal"
rounded:
  input: "0px"
  card: "12px"
  button-ghost: "22.5px"
  button-filled: "36px"
---

# OpenLTM — ORYZO-Inspired Style Reference

> Dark studio production aesthetic — warm dark canvas, flat surfaces, architectural dividers.

**Theme:** dark (forced)

OpenLTM adopts the ORYZO AI design language: a near-black warm canvas (`#100904`), flat components with zero shadows or background blurs, and dashed borders as spatial dividers. The key difference is that OpenLTM retains its own color system for category nodes and muted text hierarchy.

## Colors

| Name | Value | Role |
|------|-------|------|
| Studio Black | `#100904` | Page canvas and primary surface. |
| Warm Cream | `#ffedd7` | Primary text, headings, active borders. |
| Cork Shadow | `#40372e` | Dashed divider borders and secondary structural lines. |
| Dark Cork | `#382416` | Filled button background, hover states for table rows. |
| Burnt Sienna | `#dc5000` | Accent for link underlines, icon strokes, stars. |
| Grey Brown | `#6c5f51` | Muted text, secondary labels, inactive nav items. |

## Design Rules

### Do
- Use `#100904` as the universal background.
- Use `#ffedd7` for primary text and active interactive elements.
- Use `#6c5f51` for muted/secondary text to create hierarchy.
- Apply `36px` border-radius to filled pill buttons and `22.5px` to ghost pill buttons.
- Reserve `#dc5000` for hairline accents only (1px borders, icon strokes).
- Use `1px dashed #40372e` to divide sections.
- Keep category node colors from `nodeColors.ts` for visual variety.

### Don't
- Do not add drop shadows, box-shadows, or blur filters to any UI component.
- Do not use more than one typeface family.
- Do not add intermediate gray backgrounds between canvas and cream.

## Elevation
Zero shadows. UI components sit flat on the canvas. Separation comes from color contrast and dashed border lines.
