# DukaPay – DeFi Gamification Dashboard

## Project Overview

DukaPay transforms traditional lending and borrowing into an immersive, quest-driven experience. The goal is to bridge the gap between complex Web3 financial data and a high-engagement RPG-style interface — making DeFi accessible, rewarding, and sticky.

**Related documentation:**
- [Lender Dashboard Design](../LENDERS_DASHBOARD_DESIGN.md)

---

## Key Design Contributions

### Credit Visualisation

Designed the **Reliability Score** engine — a central data visualization hub that translates on-chain creditworthiness into a dynamic circular progress metric with real-time growth indicators. Users can immediately understand their standing without needing to parse raw chain data.

### Gamified Retention

Built the **Quest Log** and **Kingdom Tier Roadmap** systems to incentivize timely loan repayments through:

- XP progression tied to on-chain repayment behavior
- Rank-based feature unlocking
- Achievement badges for milestones (first deposit, streak repayments, etc.)

### Complex Financial States

Streamlined the **Expansion Loan** interface to present critical data — repayment deadlines, USDC amounts, interest rates — within a clean, high-contrast dark mode layout. Reduced cognitive load by grouping related financial states into scannable card components.

### System Design

Developed a cohesive visual language built around:

- Deep obsidian base palette for the dark mode environment
- Neon purples and teals as primary accent colors
- A premium "Exalted" brand feel that signals trust and sophistication

---

## Design Principles

- Clarity over complexity — financial data should never feel overwhelming
- Progression as motivation — every interaction should feel like it moves the user forward
- Dark mode first — optimized for extended sessions and Web3 aesthetics
- Consistency — shared component language across all dashboard views

---

## Color Palette

> **Scope decision (stay distinct):** the neutral shell in
> `frontend/src/app/[locale]/globals.css` (`--background`/`--foreground`)
> remains the app-wide chrome (dashboard, forms, settings). The palette below
> governs ONLY the gamified surfaces: the `/kingdom` route
> (`KingdomClient`, `KingdomProgressWidget`, `AchievementsPanel`,
> `GamificationSettings`, `LevelUpModal`, `XPGainAnimation`), the quest/tier
> modules described here, and the disconnected-wallet landing page
> (`components/landing/LandingPage.tsx`). It is formalized as reusable tokens
> under the `.kingdom` scope in `globals.css` — new code must use those
> variables instead of ad hoc hex/Tailwind classes.

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
| Text Muted | `#64748B` (large text / decorative only — see contrast table) |
| Text Muted (body-safe) | `#9AA4B5` (`--kingdom-text-muted-aa`) |
| Primary Text on dark | `#A78BFA` (`--kingdom-primary-text`; raw `#7C3AED` as text fails AA) |

### Contrast verification (WCAG 2.1, normal text AA ≥ 4.5:1)

| Pair | Ratio | Verdict | Rule |
|---|---|---|---|
| `#F1F5F9` on `#0D0D12` | 17.69:1 | AAA pass | Default body text |
| `#0ECFCF` on `#0D0D12` | 10.01:1 | AAA pass | Teal accents/links |
| White on `#7C3AED` | 5.70:1 | AA pass | CTA buttons (white text on purple fill) |
| `#22C55E` on `#0D0D12` | 8.51:1 | AAA pass | Success |
| `#9AA4B5` on `#0D0D12` | 7.71:1 | AAA pass | Body copy where muted tone is wanted |
| `#64748B` on `#0D0D12` | 4.07:1 | **Fail normal AA** (large-text only) | Never body copy; headings ≥18.66px bold / ≥24px only |
| `#7C3AED` on `#0D0D12` | 3.40:1 | **Fail normal AA** (large-text only) | Never body text; use `#A78BFA` or white-on-purple instead |

---

## Core UI Modules

### Reliability Score Widget
- Circular progress ring showing score out of 1000
- Real-time delta indicator (e.g. +12 this week)
- Tier label (e.g. "Exalted", "Sovereign", "Apprentice")

### Quest Log
- Active quests with progress bars
- XP reward previews
- Completion animations on repayment events

### Kingdom Tier Roadmap
- Horizontal tier progression (Apprentice → Sovereign → Exalted)
- Locked/unlocked state per tier
- Tooltip previews of unlockable features

### Expansion Loan Card
- Loan amount in USDC with large typographic treatment
- Repayment deadline with countdown
- Interest rate and health factor at a glance
- CTA buttons: Repay, Top Up Collateral

---

## Design Goals for Future Iterations

- Mobile-responsive layout for on-the-go portfolio monitoring
- Animated XP gain feedback on successful repayments
- Notification system tied to Quest Log completions
- Onboarding flow that introduces the tier system to new users
