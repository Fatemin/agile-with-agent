# Design System — Agile × Agent

Directly derived from the agent-kanban reference project. All rules here are authoritative.

## Aesthetic Direction
Industrial/Utilitarian. Function-first, data-aware, monospace accents. Light mode default (unlike the reference project which defaults dark). Surfaces separated by shade, not decorative lines. Reference: Linear, Raycast, Vercel.

---

## Color Tokens (CSS variables + Tailwind semantic classes)

All colors are declared in `:root` as CSS variables and mapped to Tailwind via `@theme`. **Always use the Tailwind class name, never inline `var(--*)` directly in JSX.**

### Light mode (default)
| CSS variable         | Tailwind class            | Value       | Usage |
|----------------------|---------------------------|-------------|-------|
| `--bg-primary`       | `bg-surface-primary`      | `#FAFAFA`   | App background |
| `--bg-secondary`     | `bg-surface-secondary`    | `#F4F4F5`   | Header, sidebar, panels |
| `--bg-tertiary`      | `bg-surface-tertiary`     | `#E4E4E7`   | Hover states, tags |
| `--bg-card`          | `bg-surface-card`         | `#FFFFFF`   | Cards, modals |
| `--text-primary`     | `text-content-primary`    | `#09090B`   | Headings, primary text |
| `--text-secondary`   | `text-content-secondary`  | `#52525B`   | Body text |
| `--text-tertiary`    | `text-content-tertiary`   | `#A1A1AA`   | Metadata, placeholders |
| `--accent`           | `text-accent` / `bg-accent` / `border-accent` | `#0891B2` | Interactive, CTA |
| `--accent-soft`      | `bg-accent-soft`          | `rgba(8,145,178,0.08)` | Accent chip bg |
| `--border`           | `border-border`           | `#E4E4E7`   | All borders |
| —                    | `text-success`            | `#22C55E`   | Done, positive |
| —                    | `text-warning`            | `#F59E0B`   | Stale, caution |
| —                    | `text-error`              | `#EF4444`   | Errors |

---

## Typography

Font: **Geist** (UI) + **Geist Mono** (IDs, counts, code, agent names). Load from Google Fonts.

| Class              | Size | Weight | Use |
|--------------------|------|--------|-----|
| `text-2xl font-bold` | 24px | 700 | Page headings (h1) |
| `text-base font-bold` | 16px | 700 | Card titles, agent names (font-mono) |
| `text-sm font-medium` | 14px | 500 | Sub-headings, labels |
| `text-sm`          | 14px | 400 | Body text, descriptions |
| `text-xs`          | 12px | 400/500 | Column headers (uppercase tracking-wide), nav links, badges |
| `text-[11px]`      | 11px | 400 | Story keys, metadata (font-mono) |
| `text-[10px]`      | 10px | 400 | Runtime chips, fingerprints (font-mono) |

**Rule:** IDs, keys, counts, timestamps, technical metadata → `font-mono`. Everything else → `font-sans`.

---

## Spacing & Layout

- **Base unit:** 4px
- **Card padding:** `p-3` (12px)
- **Column/section gap:** `gap-3` or `gap-4`
- **Page content:** `mx-auto max-w-6xl px-6 py-8 sm:px-8 sm:py-10` — always constrained, never full-bleed
- **Board exception:** `h-full flex flex-col` — fills viewport, columns use `border-r border-border last:border-r-0`
- **Border radius:** `rounded-lg` (cards, inputs, buttons), `rounded-xl` (panels, modals), `rounded-full` (status dots, chips)

---

## Layout Patterns

### App shell
```
<div class="min-h-screen bg-surface-primary flex flex-col">
  <Header />                            ← fixed height, border-b border-border bg-surface-secondary
  <main class="flex-1 …">              ← overflow-y-auto for non-board pages
```

### Board page (special)
```
<div class="h-screen overflow-hidden bg-surface-primary flex flex-col">
  <Header />
  <SubNav />                            ← Board/Backlog/Sprints/Epics tabs
  <div class="grid flex-1 overflow-hidden"  ← 4 equal columns
       style="grid-template-columns: repeat(4, minmax(0,1fr))">
    <KanbanColumn />                    ← border-r border-border last:border-r-0
  </div>
```

### Non-board pages
```
<div class="mx-auto max-w-6xl px-6 py-8 sm:px-8 sm:py-10">
  <header row: title + CTA button>
  <content grid / list>
</div>
```

---

## Header
```
px-5 py-3 border-b border-border bg-surface-secondary flex items-center justify-between
```
- Logo: `text-[15px] font-bold tracking-tight text-content-primary`
- Accent word: `text-accent`
- Nav links (active): `text-xs px-2.5 py-1 rounded-md text-accent bg-accent-soft`
- Nav links (inactive): `text-xs px-2.5 py-1 rounded-md text-content-tertiary hover:text-content-secondary hover:bg-surface-tertiary`
- Project name separator: `text-content-tertiary text-xs` with `/`

---

## Components

### Button (CTA / Primary)
```
inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-surface-primary hover:opacity-90
```

### Button (Ghost / Secondary)
Handled by `buttonVariants` CVA. Key variants:
- `outline`: `border-border bg-background hover:bg-muted`
- `ghost`: `hover:bg-muted hover:text-foreground`

### Card
```
overflow-hidden rounded-lg border border-border bg-surface-secondary
```
- Top accent bar: `h-[3px]` with `style={{ background: color }}`
- Hover: `hover:-translate-y-px hover:border-accent/35 transition-all`

### Kanban Card (Story)
```
w-full text-left bg-surface-card border rounded-lg p-3 cursor-pointer outline-none
transition-[border-color,box-shadow] duration-150
border-border hover:border-content-tertiary           ← inactive
border-accent/25 shadow-[0_0_16px_var(--accent-glow)] ← agent active
```

### KanbanColumn
```
flex flex-col border-r border-border last:border-r-0 min-h-0

  Header: px-4 pt-4 pb-3 flex items-center justify-between
    Title: text-xs font-semibold uppercase tracking-wide text-content-tertiary flex items-center gap-1.5
    Count: font-mono text-[11px] text-content-tertiary bg-surface-tertiary px-1.5 py-0.5 rounded

  Scroll area: flex-1 overflow-y-auto scrollbar-column px-4 pb-4
    Cards: mb-2 (gap between cards via margin)
```

### Input / Textarea
```
h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm
focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
```

### Badge / Chip (runtime, status)
```
inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-primary/70
px-2.5 py-1 font-mono text-[10px] text-content-tertiary
```

### Status dot
```
size-1.5 rounded-full bg-success   ← online
size-1.5 rounded-full bg-content-tertiary  ← offline
```

---

## Motion
- Kanban card enter: `opacity: 0→1, scale: 0.95→1, y: -6→0`, duration 200ms
- Kanban card exit: `opacity→0, scale→0.95`, 150ms
- Layout transition: 250ms
- Hover translate: `hover:-translate-y-px` (no explicit duration, uses default 150ms)
- Agent active pulse: `animate-[pulse-dot_2s_ease-in-out_infinite]` on status dot

---

## Patterns to NEVER use
- `bg-[var(--bg-card)]` — use `bg-surface-card`
- `text-[var(--text-primary)]` — use `text-content-primary`
- `border-[var(--border)]` — use `border-border`
- Full-width content without `max-w-6xl` constraint (except board)
- Sidebar navigation (always use top header)
- Dark mode class — light is the only mode in this product
