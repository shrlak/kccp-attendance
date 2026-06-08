# KCCP Re-platform · Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new React app's foundation — design system, component library, and core infra — as a deployable shell, with a placeholder check-in screen that proves the data + design + deploy path end-to-end.

**Architecture:** A Vite + React 18 + TypeScript app in `web/`, styled with Tailwind v4 driven by CSS-variable design tokens (light/dark). Server state via TanStack Query over a typed client for the existing `attendance-api` edge function (unchanged). Client state (theme, language) via persisted Zustand stores. Routing via React Router with the public check-in route plus placeholder admin/kiosk shells. PWA via vite-plugin-pwa. The legacy root `index.html` stays live on GitHub Pages throughout.

**Tech Stack:** React 18, Vite 5, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Radix UI (Dialog/Toast), lucide-react, react-i18next, Zustand, @tanstack/react-query, react-router-dom v6, vite-plugin-pwa, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-07-phase0-foundation-design.md` (design tokens in §6).

**Prerequisite:** Node 20+. All commands run from `web/` unless noted. Work on branch `replatform`.

---

## File Structure

```
web/
  index.html                 app entry html + font <link>s
  package.json               (must be un-ignored — see Task 1)
  vite.config.ts             react + tailwind + PWA plugins
  vercel.json                SPA fallback for preview deploys
  tsconfig.json · tsconfig.node.json
  vitest.config.ts
  public/icon-192.png · public/icon-512.png   (copied from repo root)
  src/
    main.tsx                 entry: providers + router mount
    index.css                tailwind import + @theme token map + base layer
    styles/tokens.css        raw CSS variables: :root (light) + .dark (dark)
    vite-env.d.ts
    lib/
      api.ts                 typed attendance-api client
      device.ts              persistent device id (reuses legacy key)
      queryClient.ts         TanStack Query client
      i18n.ts                react-i18next init
    i18n/ko.json · i18n/en.json     check-in string catalog
    stores/useTheme.ts · stores/useLang.ts    persisted Zustand stores
    components/ui/
      Button.tsx · Input.tsx · Select.tsx · Card.tsx · Tag.tsx
      BottomNav.tsx · Dialog.tsx · Toast.tsx · Icon.tsx
    app/
      AppShell.tsx           layout: providers, offline banner, toast host, <Outlet/>
      routes.tsx             router config
    features/checkin/CheckinScreen.tsx   placeholder: loads /api/config
    features/admin/AdminShell.tsx        placeholder
    features/kiosk/KioskShell.tsx        placeholder
    test/setup.ts            vitest + jest-dom + matchMedia/localStorage shims
```

**Responsibility split:** `lib/` = side-effectful integration (network, storage, i18n init). `stores/` = client state. `components/ui/` = presentational, themeable, tested in isolation. `features/` = screen composition. `app/` = shell + routing. Each file has one job; check-in *logic* (window/geo/offline) is deliberately deferred to the Phase 0 Check-in plan.

---

## Task 1: Scaffold `web/` + tooling + gitignore

**Files:**
- Create: `web/` (Vite scaffold), `web/vitest.config.ts`, `web/src/test/setup.ts`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create the branch and scaffold**

Run (from repo root):
```bash
git checkout -b replatform
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Un-ignore the web app's package files**

The root `.gitignore` ignores `package.json`/`package-lock.json` (for the legacy build-free app). Append to repo-root `.gitignore`:
```gitignore
# React re-platform app (web/) — keep its package manifests tracked
!web/package.json
!web/package-lock.json
web/dist/
web/node_modules/
```

- [ ] **Step 3: Configure Vitest**

Create `web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
```

Create `web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'

// jsdom lacks matchMedia (used by the theme store)
window.matchMedia ||= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia
```

Add to `web/package.json` `"scripts"`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Write a smoke test**

Create `web/src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('toolchain', () => {
  it('runs', () => { expect(1 + 1).toBe(2) })
})
```

- [ ] **Step 5: Verify test + dev server**

Run: `npm test`
Expected: PASS (1 test).
Run: `npm run dev` → open the printed URL → Vite default page renders. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(web): scaffold Vite+React+TS foundation with Vitest"
```

---

## Task 2: Design tokens + Tailwind v4 + fonts

**Files:**
- Create: `web/src/styles/tokens.css`, `web/src/index.css`
- Modify: `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`

- [ ] **Step 1: Install Tailwind v4**

Run: `npm install tailwindcss @tailwindcss/vite`

- [ ] **Step 2: Add the Tailwind Vite plugin**

Replace `web/vite.config.ts` with:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

- [ ] **Step 3: Define raw token variables**

Create `web/src/styles/tokens.css`:
```css
:root {
  --canvas:#FBF7F0; --surface:#FFFFFF; --surface-alt:#F2EADD; --border:#ECE2D3;
  --text:#2B2622; --muted:#7A6E5F; --subtle:#A8957E;
  --primary:#D9603D; --primary-hover:#C2542F; --primary-fg:#FFFFFF;
  --gold:#E8A23D; --success:#4F9D69; --warning:#D98A1F; --danger:#D14D4D; --info:#4A7BB8;
}
.dark {
  --canvas:#16120E; --surface:#211B15; --surface-alt:#2B2219; --border:#322A22;
  --text:#F2E9DC; --muted:#B5A48F; --subtle:#9A8466;
  --primary:#E2714B; --primary-hover:#EC8059; --primary-fg:#241009;
  --gold:#E8A23D; --success:#6FBE86; --warning:#E6B45A; --danger:#E07A6A; --info:#6FA0D6;
}
```

- [ ] **Step 4: Map tokens into Tailwind + base layer**

Create `web/src/index.css`:
```css
@import "tailwindcss";
@import "./styles/tokens.css";

/* Enable a class-based dark mode toggle (the theme store sets .dark on <html>) */
@custom-variant dark (&:where(.dark, .dark *));

/* `inline` makes utilities resolve var(--token) at runtime → theme switch works */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-alt: var(--surface-alt);
  --color-border: var(--border);
  --color-text: var(--text);
  --color-muted: var(--muted);
  --color-subtle: var(--subtle);
  --color-primary: var(--primary);
  --color-primary-hover: var(--primary-hover);
  --color-primary-fg: var(--primary-fg);
  --color-gold: var(--gold);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);
  --color-info: var(--info);

  --font-display: 'Fraunces', serif;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 20px;
}

@layer base {
  html { -webkit-tap-highlight-color: transparent; }
  body { @apply bg-canvas text-text font-sans antialiased; min-height: 100dvh; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
}
```

- [ ] **Step 5: Load fonts + import CSS**

In `web/index.html`, inside `<head>`, add:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
```
In `web/src/main.tsx`, ensure the first import is: `import './index.css'` (remove the default `App.css` import and the demo `App` if present).

- [ ] **Step 6: Verify**

Run: `npm run dev`. In the browser console run `getComputedStyle(document.body).backgroundColor` → `rgb(251, 247, 240)`. Add `document.documentElement.classList.add('dark')` → body bg becomes `rgb(22, 18, 14)`. Stop server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): design tokens, Tailwind v4 theme map, fonts"
```

---

## Task 3: Button component

**Files:**
- Create: `web/src/components/ui/Button.tsx`, `web/src/components/ui/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ui/Button.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>체크인</Button>)
    expect(screen.getByRole('button', { name: '체크인' })).toBeInTheDocument()
  })
  it('applies the primary variant by default', () => {
    render(<Button>go</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-primary')
  })
  it('renders the secondary variant', () => {
    render(<Button variant="secondary">x</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-surface')
  })
  it('is non-interactive when disabled', () => {
    render(<Button disabled>x</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run it (fails — no module)**

Run: `npm test -- Button`
Expected: FAIL ("Failed to resolve import './Button'").

- [ ] **Step 3: Implement Button**

Create `web/src/components/ui/Button.tsx`:
```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

const base =
  'inline-flex items-center justify-center gap-2 font-sans font-semibold ' +
  'transition-colors min-h-11 disabled:opacity-40 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface text-text border border-border hover:bg-surface-alt',
  ghost: 'bg-transparent text-primary hover:bg-primary/10',
  danger: 'bg-danger text-white',
}
const sizes: Record<Size, string> = {
  md: 'px-4 py-2.5 text-sm rounded-md',
  sm: 'px-3 py-1.5 text-xs rounded-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 4: Run it (passes)**

Run: `npm test -- Button`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): Button component"
```

---

## Task 4: Input, Select, Card, Tag

**Files:**
- Create: `web/src/components/ui/{Input,Select,Card,Tag}.tsx` + matching `*.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/ui/Input.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Input } from './Input'
import { Tag } from './Tag'
import { Card } from './Card'
import { Select } from './Select'

describe('primitives', () => {
  it('Input forwards placeholder + value', () => {
    render(<Input placeholder="이름" defaultValue="민준" />)
    const el = screen.getByPlaceholderText('이름') as HTMLInputElement
    expect(el.value).toBe('민준')
  })
  it('Tag renders its content with a tone class', () => {
    render(<Tag tone="primary">대학부</Tag>)
    const el = screen.getByText('대학부')
    expect(el).toBeInTheDocument()
    expect(el.className).toMatch(/rounded-full/)
  })
  it('Card renders children', () => {
    render(<Card>hello</Card>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
  it('Select renders options', () => {
    render(<Select aria-label="부서"><option value="대학부">대학부</option></Select>)
    expect(screen.getByRole('combobox', { name: '부서' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -- Input`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the four primitives**

Create `web/src/components/ui/Input.tsx`:
```tsx
import { forwardRef, type InputHTMLAttributes } from 'react'
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={
      'w-full bg-surface text-text border border-border rounded-md px-3.5 py-2.5 ' +
      'text-sm font-sans placeholder:text-subtle min-h-11 outline-none ' +
      'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 ' + className
    } {...props} />
  ),
)
Input.displayName = 'Input'
```

Create `web/src/components/ui/Select.tsx`:
```tsx
import { forwardRef, type SelectHTMLAttributes } from 'react'
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...props }, ref) => (
    <select ref={ref} className={
      'w-full bg-surface text-text border border-border rounded-md px-3.5 py-2.5 ' +
      'text-sm font-sans min-h-11 outline-none appearance-none ' +
      'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 ' + className
    } {...props} />
  ),
)
Select.displayName = 'Select'
```

Create `web/src/components/ui/Card.tsx`:
```tsx
import type { HTMLAttributes } from 'react'
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={'bg-surface border border-border rounded-lg p-5 ' + className} {...props} />
}
```

Create `web/src/components/ui/Tag.tsx`:
```tsx
import type { HTMLAttributes } from 'react'
type Tone = 'primary' | 'gold' | 'info' | 'success' | 'muted'
const tones: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  gold: 'bg-gold/15 text-gold',
  info: 'bg-info/10 text-info',
  success: 'bg-success/15 text-success',
  muted: 'bg-surface-alt text-muted',
}
export function Tag({ tone = 'muted', className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold font-sans ${tones[tone]} ${className}`} {...props} />
}
```

- [ ] **Step 4: Run it (passes)**

Run: `npm test -- Input`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): Input, Select, Card, Tag primitives"
```

---

## Task 5: BottomNav (Lucide icons, active state)

**Files:**
- Create: `web/src/components/ui/Icon.tsx`, `web/src/components/ui/BottomNav.tsx`, `web/src/components/ui/BottomNav.test.tsx`
- Install: `lucide-react`

- [ ] **Step 1: Install icons**

Run: `npm install lucide-react`

- [ ] **Step 2: Write the failing test**

Create `web/src/components/ui/BottomNav.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Home, CheckCircle } from 'lucide-react'
import { BottomNav } from './BottomNav'

const items = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'checkin', label: '출석', icon: CheckCircle },
]

describe('BottomNav', () => {
  it('renders labels and marks the active item', () => {
    render(<BottomNav items={items} active="checkin" onSelect={() => {}} />)
    const active = screen.getByRole('button', { name: '출석' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '홈' })).not.toHaveAttribute('aria-current')
  })
  it('calls onSelect with the item id', async () => {
    const onSelect = vi.fn()
    render(<BottomNav items={items} active="home" onSelect={onSelect} />)
    screen.getByRole('button', { name: '출석' }).click()
    expect(onSelect).toHaveBeenCalledWith('checkin')
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -- BottomNav`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement Icon + BottomNav**

Create `web/src/components/ui/Icon.tsx`:
```tsx
export type { LucideIcon } from 'lucide-react'
// Single import site for icons keeps stroke/size consistent across the app.
export { Home, CheckCircle, Users, BarChart3, Settings, Globe, Moon, Sun, Share2, ChevronRight } from 'lucide-react'
```

Create `web/src/components/ui/BottomNav.tsx`:
```tsx
import type { LucideIcon } from './Icon'

export interface NavItem { id: string; label: string; icon: LucideIcon }
export interface BottomNavProps {
  items: NavItem[]            // 5 max (Material guideline)
  active: string
  onSelect: (id: string) => void
}

export function BottomNav({ items, active, onSelect }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-10 mx-auto max-w-[960px] flex
                    bg-canvas/95 backdrop-blur border-t border-border
                    pb-[env(safe-area-inset-bottom)]">
      {items.slice(0, 5).map(({ id, label, icon: Icon }) => {
        const isActive = id === active
        return (
          <button key={id} type="button" onClick={() => onSelect(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 min-h-11 text-[10px] font-semibold font-sans
                        ${isActive ? 'text-primary' : 'text-subtle'}`}>
            <Icon size={20} strokeWidth={2} aria-hidden />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- BottomNav`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): Icon barrel + BottomNav"
```

---

## Task 6: Dialog + Toast (Radix, accessible)

**Files:**
- Create: `web/src/components/ui/Dialog.tsx`, `web/src/components/ui/Toast.tsx`, `web/src/components/ui/Dialog.test.tsx`
- Install: `@radix-ui/react-dialog`, `@radix-ui/react-toast`

- [ ] **Step 1: Install Radix primitives**

Run: `npm install @radix-ui/react-dialog @radix-ui/react-toast`

- [ ] **Step 2: Write the failing test**

Create `web/src/components/ui/Dialog.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('shows content when open and exposes an accessible title', () => {
    render(<Dialog open title="환영합니다" onOpenChange={() => {}}><p>body</p></Dialog>)
    expect(screen.getByRole('dialog', { name: '환영합니다' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
  it('fires onOpenChange(false) when the close button is pressed', async () => {
    let open = true
    render(<Dialog open title="t" onOpenChange={(v) => (open = v)}><p>x</p></Dialog>)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(open).toBe(false)
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -- Dialog`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement Dialog + Toast**

Create `web/src/components/ui/Dialog.tsx`:
```tsx
import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

export function Dialog({ open, onOpenChange, title, children }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <RDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))]
          -translate-x-1/2 -translate-y-1/2 bg-surface border border-border rounded-xl p-7
          focus:outline-none">
          <div className="flex items-center justify-between mb-3">
            <RDialog.Title className="font-display text-lg font-semibold text-text">{title}</RDialog.Title>
            <RDialog.Close aria-label="Close" className="text-subtle hover:text-text min-h-11 min-w-11 -mr-2 flex items-center justify-center">
              <X size={20} strokeWidth={2} aria-hidden />
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
```

Create `web/src/components/ui/Toast.tsx`:
```tsx
import * as RToast from '@radix-ui/react-toast'
import { createContext, useContext, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'warn' | 'err'
interface ToastState { title: string; tone: Tone }
const ToastCtx = createContext<(t: ToastState) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

const toneClass: Record<Tone, string> = {
  ok: 'bg-success text-white',
  warn: 'bg-warning text-[#3a2a08]',
  err: 'bg-danger text-white',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [open, setOpen] = useState(false)
  const show = (t: ToastState) => { setToast(t); setOpen(false); requestAnimationFrame(() => setOpen(true)) }
  return (
    <ToastCtx.Provider value={show}>
      <RToast.Provider duration={4000} swipeDirection="down">
        {children}
        {toast && (
          <RToast.Root open={open} onOpenChange={setOpen}
            className={`rounded-md px-4 py-2.5 text-sm font-semibold shadow-lg ${toneClass[toast.tone]}`}>
            <RToast.Title>{toast.title}</RToast.Title>
          </RToast.Root>
        )}
        <RToast.Viewport className="fixed left-1/2 -translate-x-1/2 bottom-20 z-[1100] flex flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastCtx.Provider>
  )
}
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- Dialog`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): accessible Dialog + Toast (Radix)"
```

---

## Task 7: i18n (react-i18next) + KO/EN catalog

**Files:**
- Create: `web/src/i18n/ko.json`, `web/src/i18n/en.json`, `web/src/lib/i18n.ts`, `web/src/lib/i18n.test.ts`
- Install: `i18next`, `react-i18next`

- [ ] **Step 1: Install**

Run: `npm install i18next react-i18next`

- [ ] **Step 2: Write the failing test**

Create `web/src/lib/i18n.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from './i18n'

describe('i18n', () => {
  beforeAll(async () => { await i18n.init() })
  it('defaults to Korean', () => {
    expect(i18n.t('checkin.button')).toBe('체크인')
  })
  it('switches to English', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('checkin.button')).toBe('Check in')
    await i18n.changeLanguage('ko')
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -- i18n`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement catalog + init**

Create `web/src/i18n/ko.json`:
```json
{
  "checkin": {
    "greeting": "환영합니다",
    "button": "체크인",
    "checking": "출석 확인 중…",
    "checkingLocation": "위치 확인 중…",
    "success": "체크인 완료",
    "already": "이미 출석했습니다",
    "guest": "방문자",
    "share": "공유",
    "admin": "관리자"
  },
  "register": {
    "welcome": "환영합니다!",
    "enterName": "이름을 입력해주세요",
    "firstVisit": "첫 방문이시라면 새가족팀을 찾아주세요~!",
    "namePlaceholder": "이름",
    "groupPlaceholder": "부서를 선택해주세요~",
    "save": "저장 후 출석"
  },
  "restriction": {
    "time": "출석 시간이 아닙니다",
    "day": "출석 가능한 요일이 아닙니다",
    "locationRequired": "위치 정보가 필요합니다. 위치 접근을 허용해주세요.",
    "locationFar": "교회 근처에서만 출석할 수 있습니다."
  },
  "offline": { "queued": "오프라인 — 대기열에 저장됨", "synced": "출석이 동기화되었습니다" },
  "common": { "cancel": "취소", "save": "저장", "loading": "불러오는 중…", "error": "연결 오류" }
}
```

Create `web/src/i18n/en.json`:
```json
{
  "checkin": {
    "greeting": "Welcome",
    "button": "Check in",
    "checking": "Checking in…",
    "checkingLocation": "Checking location…",
    "success": "Checked in",
    "already": "Already checked in",
    "guest": "Guest",
    "share": "Share",
    "admin": "Admin"
  },
  "register": {
    "welcome": "Welcome!",
    "enterName": "Please enter your name",
    "firstVisit": "First time? Please find the welcome team~!",
    "namePlaceholder": "Name",
    "groupPlaceholder": "Select your group~",
    "save": "Save & check in"
  },
  "restriction": {
    "time": "Check-in is not open right now",
    "day": "Today is not a check-in day",
    "locationRequired": "Location is required. Please allow location access.",
    "locationFar": "You can only check in near the church."
  },
  "offline": { "queued": "Offline — saved to queue", "synced": "Attendance synced" },
  "common": { "cancel": "Cancel", "save": "Save", "loading": "Loading…", "error": "Connection error" }
}
```

Create `web/src/lib/i18n.ts`:
```ts
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from '../i18n/ko.json'
import en from '../i18n/en.json'

export const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: 'ko',
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
})
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- i18n`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): i18n setup + KO/EN check-in catalog"
```

---

## Task 8: Theme + language stores (Zustand, persisted)

**Files:**
- Create: `web/src/stores/useTheme.ts`, `web/src/stores/useLang.ts`, `web/src/stores/stores.test.ts`
- Install: `zustand`

- [ ] **Step 1: Install**

Run: `npm install zustand`

- [ ] **Step 2: Write the failing test**

Create `web/src/stores/stores.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from './useTheme'
import { useLang } from './useLang'

beforeEach(() => { localStorage.clear(); document.documentElement.className = '' })

describe('useTheme', () => {
  it('toggles and reflects on <html>.dark', () => {
    useTheme.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    useTheme.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
  it('persists the choice', () => {
    useTheme.getState().setTheme('dark')
    expect(localStorage.getItem('kccp-theme')).toContain('dark')
  })
})

describe('useLang', () => {
  it('defaults to ko and switches', () => {
    expect(useLang.getState().lang).toBe('ko')
    useLang.getState().setLang('en')
    expect(useLang.getState().lang).toBe('en')
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -- stores`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the stores**

Create `web/src/stores/useTheme.ts`:
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'
interface ThemeState { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      setTheme: (theme) => { apply(theme); set({ theme }) },
      toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    { name: 'kccp-theme', onRehydrateStorage: () => (state) => state && apply(state.theme) },
  ),
)
// Apply current value at module load (covers first paint before React mounts).
apply(useTheme.getState().theme)
```

Create `web/src/stores/useLang.ts`:
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { i18n } from '../lib/i18n'

type Lang = 'ko' | 'en'
interface LangState { lang: Lang; setLang: (l: Lang) => void; toggle: () => void }

export const useLang = create<LangState>()(
  persist(
    (set, get) => ({
      lang: 'ko',
      setLang: (lang) => { i18n.changeLanguage(lang); set({ lang }) },
      toggle: () => get().setLang(get().lang === 'ko' ? 'en' : 'ko'),
    }),
    { name: 'kccp-lang', onRehydrateStorage: () => (state) => state && i18n.changeLanguage(state.lang) },
  ),
)
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- stores`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): persisted theme + language stores"
```

---

## Task 9: API client + device id + query client

**Files:**
- Create: `web/src/lib/api.ts`, `web/src/lib/device.ts`, `web/src/lib/queryClient.ts`, `web/src/lib/api.test.ts`, `web/.env`
- Install: `@tanstack/react-query`

- [ ] **Step 1: Install + env**

Run: `npm install @tanstack/react-query`
Create `web/.env`:
```
VITE_API_BASE=https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api
```
(Value taken from legacy `API_BASE`, index.html:924. CORS on the edge function is `*`, so the browser can call it directly in dev and prod.)

- [ ] **Step 2: Discover and reuse the legacy device-id key**

The legacy app keeps a persistent id in the global `deviceId` (index.html:912), loaded from localStorage during init. Find the exact key:
```bash
grep -nE "deviceId\s*=\s*localStorage|localStorage\.(getItem|setItem)\([^)]*\)[^;]*deviceId|deviceId\s*=\s*.*\|\|" ../index.html
```
Use the discovered key string as `DEVICE_KEY` in Step 4 so existing installs keep their identity and attendance history. (If none is found, the legacy app generated one on first use — match that scheme; default below.)

- [ ] **Step 3: Write the failing test**

Create `web/src/lib/api.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'
import { getDeviceId } from './device'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('getDeviceId', () => {
  it('creates a stable id and reuses it', () => {
    const a = getDeviceId()
    expect(a).toBeTruthy()
    expect(getDeviceId()).toBe(a)
  })
})

describe('api', () => {
  it('POSTs JSON to API_BASE + path and returns parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await api('POST', '/api/checkin', { deviceId: 'X', lat: 1, lng: 2 })
    expect(r).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/checkin')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ deviceId: 'X', lat: 1, lng: 2 })
  })
  it('sends the X-Device-Id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api('GET', '/api/data')
    expect(fetchMock.mock.calls[0][1].headers['X-Device-Id']).toBe(getDeviceId())
  })
})
```

- [ ] **Step 4: Implement device.ts, api.ts, queryClient.ts**

Create `web/src/lib/device.ts`:
```ts
// Reuse the legacy localStorage key (see Step 2) so existing installs keep identity.
const DEVICE_KEY = 'kccp-device-id' // ← replace with the exact legacy key from Step 2
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) { id = 'DEV-' + crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id) }
  return id
}
```

Create `web/src/lib/api.ts`:
```ts
import { getDeviceId } from './device'

const API_BASE = import.meta.env.VITE_API_BASE as string
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const resp = await fetch(API_BASE + path, {
      method, headers, signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined,
    })
    clearTimeout(timer)
    try { return (await resp.json()) as T }
    catch { return { error: `HTTP ${resp.status} — non-JSON response` } as T }
  } catch (e) { clearTimeout(timer); throw e }
}

// Phase-0 response shapes (from the attendance-api edge function)
export interface AppConfig {
  announcement: string; checkinDays: number[]; checkinStartMin: number; checkinEndMin: number
  requireApproval: boolean; summerMode: boolean; demoMode: boolean; individualCheckinEnabled: boolean
}
export const getConfig = () => api<AppConfig>('GET', '/api/config')
```

Create `web/src/lib/queryClient.ts`:
```ts
import { QueryClient } from '@tanstack/react-query'
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
})
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- api`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): attendance-api client, device id, query client"
```

---

## Task 10: Router + AppShell + screens

**Files:**
- Create: `web/src/app/AppShell.tsx`, `web/src/app/routes.tsx`, `web/src/features/checkin/CheckinScreen.tsx`, `web/src/features/admin/AdminShell.tsx`, `web/src/features/kiosk/KioskShell.tsx`, `web/src/app/routes.test.tsx`
- Modify: `web/src/main.tsx`
- Install: `react-router-dom`

- [ ] **Step 1: Install**

Run: `npm install react-router-dom`

- [ ] **Step 2: Write the failing test**

Create `web/src/app/routes.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { AppRoutes } from './routes'

beforeEach(() => { queryClient.clear() })

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it('renders the check-in screen at /', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      announcement: '', checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900,
      requireApproval: false, summerMode: false, demoMode: false, individualCheckinEnabled: false,
    }), { status: 200 })))
    renderAt('/')
    expect(await screen.findByRole('button', { name: '체크인' })).toBeInTheDocument()
  })
  it('renders the admin placeholder at /admin', () => {
    renderAt('/admin')
    expect(screen.getByText(/admin/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -- routes`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement screens, shell, routes, entry**

Create `web/src/features/checkin/CheckinScreen.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getConfig } from '../../lib/api'
import { Button } from '../../components/ui/Button'

// Phase-0 PLACEHOLDER: proves data + design + deploy end-to-end.
// The real check-in flow (window/geo/offline/guest) lands in the Phase 0 Check-in plan.
export function CheckinScreen() {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-text">{t('checkin.greeting')}</h1>
      {data?.announcement && <p className="text-muted text-sm max-w-sm">{data.announcement}</p>}
      <Button disabled={isLoading}>{t('checkin.button')}</Button>
      <p className="font-mono text-xs text-subtle">{isLoading ? t('common.loading') : 'config loaded ✓'}</p>
    </main>
  )
}
```

Create `web/src/features/admin/AdminShell.tsx`:
```tsx
export function AdminShell() {
  return <main className="min-h-dvh grid place-items-center text-muted font-mono text-sm">Admin — coming in Phase 1</main>
}
```

Create `web/src/features/kiosk/KioskShell.tsx`:
```tsx
export function KioskShell() {
  return <main className="min-h-dvh grid place-items-center text-muted font-mono text-sm">Kiosk — coming in Phase 3</main>
}
```

Create `web/src/app/AppShell.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { ToastProvider } from '../components/ui/Toast'

export function AppShell() {
  const [offline, setOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return (
    <ToastProvider>
      {offline && (
        <div className="fixed top-0 inset-x-0 z-[200] bg-warning text-[#3a2a08] text-center text-xs font-semibold py-1.5
                        pt-[calc(0.375rem+env(safe-area-inset-top))]">
          오프라인 모드
        </div>
      )}
      <Outlet />
    </ToastProvider>
  )
}
```

Create `web/src/app/routes.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './AppShell'
import { CheckinScreen } from '../features/checkin/CheckinScreen'
import { AdminShell } from '../features/admin/AdminShell'
import { KioskShell } from '../features/kiosk/KioskShell'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<CheckinScreen />} />
        <Route path="/admin" element={<AdminShell />} />
        <Route path="/kiosk" element={<KioskShell />} />
      </Route>
    </Routes>
  )
}
```

Replace `web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './lib/i18n'
import './stores/useTheme'
import { queryClient } from './lib/queryClient'
import { AppRoutes } from './app/routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><AppRoutes /></BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [ ] **Step 5: Run it (passes)**

Run: `npm test -- routes`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify in browser**

Run: `npm run dev` → `/` shows the greeting + 체크인 + "config loaded ✓"; `/admin` and `/kiosk` show placeholders. Stop server.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): router, AppShell, check-in placeholder + admin/kiosk shells"
```

---

## Task 11: PWA (vite-plugin-pwa)

**Files:**
- Modify: `web/vite.config.ts`, `web/src/main.tsx`
- Create: `web/public/icon-192.png`, `web/public/icon-512.png`
- Install: `vite-plugin-pwa`

- [ ] **Step 1: Install + copy icons**

Run (from `web/`): `npm install -D vite-plugin-pwa`
Run: `cp ../icon-192.png ../icon-512.png public/`

- [ ] **Step 2: Configure the plugin**

Update `web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',          // fixes the stale-cache class of bug (legacy #37)
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'KCCP 출석', short_name: 'KCCP 출석',
        start_url: '/', display: 'standalone',
        theme_color: '#D9603D', background_color: '#FBF7F0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
```

- [ ] **Step 3: Register the service worker**

In `web/src/main.tsx`, add after the imports:
```tsx
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })
```
Add to `web/src/vite-env.d.ts`:
```ts
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 4: Verify the build emits a service worker + manifest**

Run: `npm run build`
Expected: build succeeds; `dist/` contains `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
Run: `npm run preview` → DevTools ▸ Application ▸ Manifest shows "KCCP 출석"; a service worker is registered. Stop server.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): PWA via vite-plugin-pwa (manifest, SW, icons)"
```

---

## Task 12: Deploy config (Vercel preview + SPA fallback)

**Files:**
- Create: `web/vercel.json`
- Modify: `web/vite.config.ts` (only if a non-root base is needed)

- [ ] **Step 1: Add SPA fallback for previews**

Create `web/vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 2: Note the base-path decision (no code change yet)**

Preview + production both serve from `/`, so the default Vite `base: '/'` is correct. **Do not** set a non-root base unless production later moves to a GitHub Pages *project* path (`/<repo>/`); record that as a cutover-time task, not now.

- [ ] **Step 3: Connect the preview deploy**

In the Vercel dashboard (or `vercel` CLI): import the repo, set **Root Directory = `web`**, framework preset **Vite**, and add env var `VITE_API_BASE` (same value as `web/.env`). Pushing the `replatform` branch produces a preview URL. *(If staying local-only instead: skip this; use `npm run preview` + a cloudflared/ngrok HTTPS tunnel for phone testing.)*

- [ ] **Step 4: Verify on a phone**

Open the preview URL on a phone: page renders in the warm theme; "Add to Home Screen" installs it; the check-in screen shows "config loaded ✓" (proves the live API path over HTTPS).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(web): Vercel SPA-fallback config + base-path note"
```

---

## Task 13: Foundation verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test + typecheck + build**

Run (from `web/`):
```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: all tests PASS; no type errors; build succeeds.

- [ ] **Step 2: Manual design-system + theme check**

`npm run preview`. Verify on `/`: Fraunces heading, Inter body, clay-coral 체크인 button, cream background. Toggle dark via console (`document.documentElement.classList.toggle('dark')`) → warm-charcoal theme, text stays legible. Confirm focus ring on Tab to the button. Stop server.

- [ ] **Step 3: Definition-of-done check against the spec**

Confirm: deployable shell ✓, design system in both themes ✓, component library (Button/Input/Select/Card/Tag/BottomNav/Dialog/Toast) ✓, i18n KO/EN ✓, api client + device id ✓, routing + placeholder check-in loading `/api/config` ✓, PWA install/SW ✓, production GitHub Pages still serving legacy ✓ (no cutover).

- [ ] **Step 4: Final commit / push the branch**

```bash
git push -u origin replatform
```

---

## Self-Review

- **Spec coverage:** Foundation items from spec §4–§6 map to Tasks 1–13 (tokens→T2, components→T3–T6, i18n→T7, stores→T8, api/data→T9, routing/shell→T10, PWA→T11, deploy→T12). Check-in *logic* (window/geo/offline/guest, spec §5/§8) is intentionally deferred to the Phase 0 Check-in plan; the placeholder in T10 covers only the data-path proof. Roles/ACL + admin auth are out of Phase 0 per spec §2 (shells only).
- **Placeholders:** `DEVICE_KEY` in T9 is the one value resolved at execution (T9 Step 2 gives the exact grep to find it) — flagged deliberately so existing installs keep identity, not a vague TODO.
- **Type consistency:** `api()` signature `(method, path, body)` is used consistently (T9 def → T10 `getConfig`). `AppConfig` fields match the edge function's `/api/config` response (index.ts:460–472). Token utility names (`bg-canvas`, `text-text`, `bg-primary`, …) match the `@theme` map in T2.
