# DukaPay — UI/UX Design Brief (Reverse-Engineered)

> ⚠️ **Two design languages coexist in this codebase** and neither cancels the other out — treat this as intentional layering (neutral shell + gamified sub-brand), not an inconsistency to silently pick one side of.

## Design Language 1 — Base App Shell (from `frontend/src/app/globals.css`)

- **Aesthetic**: minimal, accessibility-first, neutral. Explicit WCAG AA contrast comments in the CSS itself.
- **Light mode**: background `#ffffff`, foreground `#171717` (contrast ratio 15.9:1, commented in source)
- **Dark mode**: background `#0a0a0a`, foreground `#ededed` (15.5:1), applied via `prefers-color-scheme` and a class-based `.dark` override (`@custom-variant dark`)
- **Focus ring**: `#4f46e5` (indigo) — explicit `:focus-visible` styling, `:focus:not(:focus-visible)` reset — accessibility was clearly a deliberate concern, not an afterthought.
- **Fonts**: Geist Sans (UI), Geist Mono (code/mono contexts) — Next.js default font pairing, referenced via CSS variables (`--font-geist-sans`, `--font-geist-mono`).
- **Framework**: Tailwind CSS v4, CSS-first config (`@theme inline` block maps CSS vars to Tailwind color tokens) — there is no `tailwind.config.js`; theme lives entirely in `globals.css`.
- Custom utility animations defined inline: `animate-reverse-spin`, `animate-dot-bounce` (used for loading indicators).

## Design Language 2 — "Kingdom" Gamification Brand (from `docs/DESIGN.md`)

This is documented separately and clearly describes a distinct visual mode for the credit-score/gamification surfaces (`/kingdom`, credit score widgets, quest log):

- **Aesthetic**: dark-mode-first, RPG/Web3-premium ("Exalted" brand feel), described explicitly as bridging "complex Web3 financial data" with a "high-engagement RPG-style interface."
- **Palette**:
  | Role | Value |
  |---|---|
  | Background | `#0D0D12` (Obsidian) |
  | Surface | `#16161F` |
  | Primary Accent | `#7C3AED` (Neon Purple) |
  | Secondary Accent | `#0ECFCF` (Teal) |
  | Success | `#22C55E` |
  | Warning | `#F59E0B` |
  | Danger | `#EF4444` |
  | Text Primary | `#F1F5F9` |
  | Text Muted | `#64748B` |
- **Key modules**: Reliability Score widget (circular progress ring, 0–1000 scale, tier label), Quest Log (progress bars, XP preview, completion animation), Kingdom Tier Roadmap (Apprentice → Sovereign → Exalted, locked/unlocked states), Expansion Loan Card (large typographic loan amount, countdown, health factor).
- **Principles stated in the doc**: clarity over complexity, progression as motivation, dark-mode-first, component-language consistency.

## Reconciling the two

Practical read: `globals.css` sets the **app-wide neutral shell and accessibility baseline** (used everywhere — forms, tables, settings, admin). The Obsidian/purple/teal palette from `docs/DESIGN.md` is **not wired into `globals.css` as CSS variables** — it appears to live as a design spec for the `/kingdom` and gamification components specifically, likely applied via component-local Tailwind classes rather than global tokens. If you're building in the Kingdom/credit-score surfaces, use the Obsidian palette; everywhere else, use the neutral `--background`/`--foreground` tokens.

> Gap: no single source confirms whether the two palettes are meant to merge into one dark theme or stay visually distinct per-surface. Worth a design decision from a human before extending either further.

## Component Style

- Rounded, card-based UI: `Card.tsx`, dedicated status/badge components (`LoanStatusBadge.tsx`, `StatusIndicator.tsx`), progress components (`RepaymentProgress.tsx`, `LoanTimeline.tsx`, `OperationProgress.tsx`).
- A real design-system layer exists under `components/ui/`: `Button`, `Input`, `Modal`, `Toast`/`Toaster`, `Tooltip`, `Skeleton`, `PaginationControls`, `CopyButton`, `ThemeToggle`, `ConfirmTransactionDialog`, `TxHashLink` (blockchain-explorer-style hash linking) — these are the primitives to reuse, not rebuild.
- A `/ui-demo` page exists specifically to showcase these components in isolation — check it before building a new primitive.

## Dark/Light Mode

- Both modes are implemented (`ThemeToggle.tsx`, CSS supports both `prefers-color-scheme` and manual `.dark` class toggle) — this is not "dark mode only" despite the Kingdom doc's dark-first framing.

## Reference Apps

Not explicitly named anywhere in the repo. The Obsidian/neon palette and RPG framing suggest inspiration from Web3/DeFi dashboards and gamified fintech apps, but no specific reference app is cited in any doc — don't assume Linear/Notion/Vercel-style minimalism beyond the neutral base shell.

## Mobile Responsiveness

- Confirmed: bottom tab navigation for mobile (`BottomNav.tsx`), install prompt for PWA (`InstallPrompt.tsx`), Lighthouse CI perf budgets (`lighthouse-budget.json`) enforced in CI (`lighthouse-ci.yml`) — mobile performance is actively gated, not just responsive-by-accident.

## Accessibility

- WCAG AA contrast explicitly verified and commented in `globals.css` for both light and dark base palettes.
- `axe-playwright` a11y audit script (`npm run audit:a11y`) — automated a11y testing exists, run it before shipping new UI.
- **Not verified**: whether the Kingdom/Obsidian palette (`#7C3AED` on `#0D0D12`, `#64748B` muted text) meets the same AA bar — no contrast comments accompany that palette. Worth checking before scaling it out.
