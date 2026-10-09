# Medical Briefing Admin Design System

## 1. Atmosphere & Identity

The Admin is a warm, restrained operations workspace. Existing cream page
backgrounds, white information surfaces, and dark-brown navigation keep it
visually connected to the Medical Briefing service while allowing technical
monitoring data to stay compact and legible. This addition reuses the current
Admin language rather than introducing a second dashboard system.

## 2. Color

| Role | Existing value | Usage |
|---|---|---|
| Page surface | #FDFBF7 | Admin background |
| Card surface | #FFFFFF | Monitoring sections |
| Primary ink | #1F2937 | Header and primary text |
| Brand ink | #5C2D0C | Admin navigation and headings |
| Border | #E8DCCB | Existing card outlines |
| Success | Tailwind green-100 / green-700 | Normal state |
| Warning | Tailwind yellow-100 / yellow-700 | Degraded state |
| Failure | Tailwind red-100 / red-700 | Failed state |
| Information | Tailwind blue-50 / blue-800 | Supporting metrics |

Status color is paired with a text label. No new semantic color is introduced.

## 3. Typography

Admin uses the existing application sans-serif stack and Tailwind's current
font-size and weight utilities. Section headings use font-bold; compact
metadata uses the existing text-xs and text-sm styles.

## 4. Spacing & Layout

Spacing follows the existing 4px Tailwind utility scale. The content container
is max-w-6xl; the monitoring layout uses one column on small screens and adds
columns at the existing md and lg breakpoints. Dense tables scroll horizontally
inside their own overflow container.

## 5. Components

### Monitoring section

- **Structure**: section header followed by a white rounded card body.
- **Variants**: operational summary, source-health history, run history.
- **Spacing**: existing px-6, py-5, p-6, and gap-4 utilities.
- **States**: loading, populated, empty, and query-error content remain explicit.
- **Accessibility**: headings are nested, tables use semantic thead and tbody,
  status is text-labelled, and horizontal overflow stays inside the table wrapper.
- **Motion**: none beyond existing utility transitions on interactive controls.
- **Layout**: document flow; the table wrapper owns horizontal overflow.

### Status badge

- **Structure**: text label in a rounded inline span.
- **Variants**: NORMAL, DEGRADED, FAILED, STALE.
- **Spacing**: compact existing px-2 py-1 utility.
- **States**: always includes a textual state, not color alone.
- **Accessibility**: readable contrast and meaning independent of color.
- **Motion**: none.
- **Layout**: inline cluster.

## 6. Motion & Interaction

### Public source link guidance

Public article links reuse the existing blue-50/blue-700 information treatment,
white surfaces, text-xs/text-sm type and 4px spacing scale. `SourceLink` is the
shared primitive for tables, source cards, related links and article lists.
Table actions share a 44px square blue-50 button, blue-100 border and rounded-lg
corners. Verified links use ExternalLink; institutional guidance uses Info.
Verified detail links preserve their original href and open a new tab.
Unverified portal routes open a native modal dialog labelled “기관에서 공지 찾기”
with institution, board, full article title and confirmed navigation steps.
The explicit institution link opens a new tab with noopener/noreferrer; it never
includes a guessed article ID. Guidance wraps with break-keep and whitespace-normal,
inside a viewport-constrained 448px white surface in the browser top layer, clear
of table overflow. The dialog supports Escape, backdrop and an explicit close
button; native modal focus containment and restoration apply. Keyboard focus uses
the existing blue focus-visible ring; controls have a minimum 44px target.
Cards and related links retain contextual text and open the same guidance.
No new animation, dependency or colour token is introduced. Unsafe URLs remain noninteractive.

Monitoring is read-only. Existing button transition-colors behavior remains
unchanged; status and history updates do not animate layout.

## 7. Depth & Surface

The page uses white cards with the existing subtle shadow-sm and warm border.
Status panels use existing tinted backgrounds rather than new elevation levels.
Card radius remains rounded-xl; compact labels remain rounded-full.

## 8. Accessibility Constraints & Accepted Debt

New monitoring content must retain semantic headings and table markup, readable
text contrast, and a textual label for each status. Narrow screens may scroll
the source table horizontally without causing page-level overflow. No new
accessibility debt is accepted by this change.
