# Medical Briefing Admin Design System

## PWA installation

Preserve the existing bear dashboard and login. Installation help is a native
details/summary disclosure, with a 44px target, visible keyboard focus and
wrapping Korean instructions. Dashboard help uses its existing white/slate
surface and blue #1D4ED8 ink; login reuses it below the existing form.
Offline fallback uses #F8F9FA background, white surface, #191919 ink,
#1D4ED8 links, 4px spacing, 24px heading and 16px body. Bear app icons use
the existing illustration on #FFF8D8. No new motion or runtime dependency.
The document owns scrolling. Offline mode explains the connection requirement;
it never stores authenticated pages, articles, API responses or credentials.

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

### Customer password visibility

The customer login uses the same Eye/EyeOff visibility control inside the
shared-password field. It preserves the login's slate/blue palette, rounded-xl
corners and 44px input height. A 44px right-hand button has reserved pr-12 input
space, an action label, aria-controls, aria-pressed and a keyboard focus ring.
The password starts masked and is masked again when login is submitted.
The toggle preserves the typed value and never submits the form.
Explicit reveal/hide replaces the input element while preserving its controlled
value. This lets the visible text input accept Korean IME on Mac Chrome rather
than inheriting the previous password element's secure-input history. Hidden
mode remains a native password input. Typing itself never replaces the element.

The shared-password dialog reuses the 44px `ca-input` and `ca-icon-button`
primitives. Each password input reserves the existing `pr-12` spacing scale
for a right-aligned Eye/EyeOff button without changing its height. Inputs start
masked; each button independently reveals or hides only its associated input.
Closing the dialog unmounts these controls, so reopening always starts masked.
Buttons use the existing focus-visible ring, native keyboard activation,
action labels and titles, `aria-controls`, and `aria-pressed`. Visibility never
submits the form, persists a password, or changes validation or authorization.

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

## 9. Support center (MB-006 Phase 2)

Preserve the existing customer-admin slate/blue system and internal-admin warm
brown system. Customer pages use #F7F9FC, slate-800/500, blue-600/700,
white surfaces, slate-200 borders and the existing ca-card/ca-input geometry.
Internal support uses the same reusable primitives with page #FDFBF7,
brand #5C2D0C, border #E8DCCB and white surfaces. No separate visual theme is
introduced. Both are deliberately light workspaces even when the OS is dark,
matching the existing admin pages; page colors are explicitly scoped.

The document owns vertical scroll. A centered max-w-6xl content column contains
navigation, title, list or detail. List rows become stacked cards on phones;
detail content and management forms stack below lg and use a supporting rail
above lg. Min-width:0, break-keep and overflow-wrap:anywhere contain long Korean
and unbroken input. Structural reference: StyleGallery supporting-pane and
pagination, https://github.com/changeroa/StyleGallery (adapted, no copied prose).

Reusable support primitives: branded button (idle/hover/focus/disabled/saving),
labelled status badge, request list, state panel (loading/empty/error/disabled),
pagination, labelled input/textarea/select, public response feed and internal
history feed. Use 4px spacing, text-xs/sm/base, 24px/30px page heading,
rounded-xl surfaces, rounded-full badges, subtle shadow-sm. All actions have
44px targets and a visible 2px accent focus ring. Status always includes text.
Danger is red-50/red-800; information blue-50/blue-800; secondary slate-50/700.

New-request dialog uses the existing native Dialog primitive: Escape close,
focus containment/restoration, first field focus, viewport-contained scrolling.
Detail navigation focuses its heading; returning focuses the selected row.
Conflict keeps edits, reloads current data, and requires explicit acknowledgement
before resubmission. Forms announce saving, success and errors; duplicate saves
are blocked. Motion is limited to existing 150ms background-color transitions
and removed with prefers-reduced-motion. No hero, animation library or runtime
debug overlay is added to these existing authenticated operations surfaces.

Personas: customer administrator filing/reading requests, internal operator
triaging and replying, keyboard/screen-reader users, and phone users. Customer
detail never renders internal notes, actor IDs or audit data. Plain React text
renders all submitted content. Accepted limitations: no attachment UI, named
operator account redesign or customer reply composer in this phase. Managed
Supabase rollout remains independently gated; test mocks are tests-only.

## 10. Support attachments (Phase 3)

Reuse support-card, ca-input, support-button, text badges and the blue/brown
audience accents. Attachment rows wrap filename/size/state/actions on phones;
image thumbnails occupy a fixed 96px square with object-fit:contain. The
document owns scrolling. A labelled multiple file input remains the Safari
fallback for paste; every image has an alt label and a removal button with a
44px target. Pending/scanning/clean/infected/failed are always written in text.
Progress uses a named native progress element and polite announcements. Keep
request text and selected files after partial failure; retain the created request
ID for upload retry instead of POSTing another request. Revoke object URLs on
removal/unmount. Remote thumbnails load only from authenticated clean-image API
responses. No unscanned remote image or public Storage link is rendered.
Feature remains independently disabled until storage and a real scanner pass
acceptance. Test clean results never substitute for production scanning.

## 11. CSR board MVP

Use the existing support surfaces as a simple list, compose dialog and detail
with replies. The edu-team-tms CSR card is a structural reference only; keep
this application's private attachments and authentication. Remove priority,
internal notes and audit/history controls from this UI. Their API and DB remain.
Reuse all existing spacing, audience colors, typography and accessible controls.
Display received as 접수; reviewing/in_progress/waiting_customer/on_hold as
처리 중; completed/cancelled as 완료. Cancelled requests remain terminal.
Status changes follow the existing DB transition graph with version checks at
each step. Interrupted changes reload the current state before another save.
Show an explicit attachment-unavailable message when uploads are disabled.
Replies alone determine detail pagination. Keep phone stacking and desktop rail.

## 12. Remember login

Customer login reuses slate/blue text, 4px spacing and the existing focus ring.
An unchecked native checkbox has a labelled 44px-high click target, keyboard
Space support and disabled/busy states. Supporting text explains the rolling
30-day window and personal-PC use. No credentials or preferences enter browser
storage. CustomerSession renews only while the document is visible.

## 13. ID usage

Reuse customer-admin ca-card, ca-input, ca-primary/secondary, slate/blue colors,
44px controls and 4px spacing. Reuse CustomerAdminNav and the existing light
workspace in either OS theme. The document owns scrolling. A wrapping filter
form precedes a paginated ID list; native details exposes period breakdowns.
On phones metrics stack; table overflow stays within each expanded detail.
Idle/loading/error/empty/populated states are explicit. Search applies on
submit, stale data clears on failure, status announces loading and page changes.
Date inputs and selects retain native controls and visible focus. No motion,
new dependency, runtime overlay, or unrelated tooling installation is added.

Usage query primary-button press uses the existing Tailwind blue-800 ramp
(#1e40af), darker than blue-700 hover. Native keyboard focus rings stay visible.
