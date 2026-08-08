# Design system and kiosk shell

## Contents

- [Goals and constraints](#goals-and-constraints)
- [Design alternatives](#design-alternatives)
- [Token architecture](#token-architecture)
- [Shell architecture](#shell-architecture)
- [Typography and font loading](#typography-and-font-loading)
- [Browser-first validation](#browser-first-validation)
- [Implementation boundaries](#implementation-boundaries)

## Goals and constraints

Spec 1 establishes the visual foundation and shared layout for the self-service checkout UI. It must reflect the PRD's touch-first, high-contrast, calm transaction flow: warm paper surfaces, charcoal text, and one forest-green accent reserved for primary and selected states. UI copy uses sentence case, avoids emoji and promotional filler, and numbers that need quick recognition use a monospace face.

Every in-flow screen uses the same fixed-height column: a non-scrolling header, a scrollable content region, and a pinned opaque bottom action bar. The action bar must remain visible while the content region scrolls. This foundation has no backend dependency and must be usable by later kiosk, menu, checkout, kitchen, and abandonment screens.

The implementation stays within the repository's Tailwind v4 CSS-first and shadcn/ui setup. It will not add a JavaScript Tailwind config or a second theme mechanism.

## Design alternatives

1. **CSS variables plus Tailwind v4 `@theme inline` (recommended).** Keep raw palette, type, spacing, radii, shadows, and semantic aliases in `src/styles.css`; expose those aliases to Tailwind utilities through `@theme inline`. This is the existing shadcn-compatible architecture, supports runtime CSS-variable theming, and lets component code use either semantic utilities or direct token utilities without duplication.
2. **A JavaScript Tailwind theme config.** This offers a familiar object-shaped theme, but Tailwind v4 is CSS-first and the config would duplicate the source of truth, complicate variable-based theming, and diverge from the existing `components.json` setup.
3. **Component-local arbitrary values.** This has low initial ceremony, but repeats colors and dimensions across screens and makes later screens drift from the visual foundation. It is rejected because design tokens are an explicit requirement.

## Token architecture

`src/styles.css` will replace the starter neutral oklch values with the approved token vocabulary from `references.md`, retaining shadcn semantic variable names as aliases. Core values include:

- Surfaces: paper `#f7f5f0`, cream `#fbfaf7`, white, and inverse ink.
- Text and borders: ink 900/700/500/300/150/100, with primary, secondary, tertiary, inverse, and on-accent aliases.
- Accent and semantic colors: forest 700/600/500/100; amber 600/500/100 for warnings; red 600/500/100 for danger. Forest is the only decorative/primary accent.
- Typography: Inter UI text and JetBrains Mono glanceable numbers, with the display, heading, body, caption sizes, line-heights, and weights from the reference converted to rem.
- Layout primitives: the 4px spacing scale through 96px, md/lg/xl/pill radii, and soft sm/md/lg/focus shadows from the reference converted to rem where applicable.

The semantic aliases used by shadcn (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, and their foreground values) point at the approved semantic tokens. `@theme inline` exposes color, font, radius, spacing, and shadow variables to Tailwind v4, so classes remain readable (`bg-background`, `text-primary`, `font-mono`, `rounded-md`, `shadow-sm`) and custom properties remain the single source of truth. The existing `components.json` remains CSS-variable based (`cssVariables: true`, `tailwind.config: ""`, `css: "src/styles.css"`) and uses the Lucide icon library; its base color is aligned to the neutral/ink palette rather than introducing a competing color system.

No dark-mode token set is added for this spec. The PRD calls for flat paper on in-flow screens and inverse charcoal only where a later screen explicitly needs it; a `.dark` override would imply an unsupported user-selectable theme.

## Shell architecture

Add a small reusable shell component under `src/components/` with explicit slots for `header`, scrollable `children`, and `bottomBar`. The shell renders a semantic container with these layout guarantees:

```text
Shell (min-h-dvh h-dvh flex flex-col overflow-hidden)
├── header (flex-none)
├── main content (min-h-0 flex-1 overflow-y-auto)
└── bottom action bar (flex-none, opaque, safe-area aware)
```

The header and bottom bar never participate in the scrolling context. The content wrapper is the only scroll container and receives `min-h-0` so flexbox can shrink it on tablet viewports. The bottom bar has an opaque card surface, a subtle ambient shadow, and bottom padding that includes `env(safe-area-inset-bottom)`. Its controls use large touch targets and forest-green primary styling; content screens may supply their own actions without changing the shell contract.

The index route becomes a representative shell screen so the browser test exercises the real application path. It uses sentence-case sample content, a Lucide outline icon with a 2px stroke, a mono-formatted price, and enough content to prove the middle region scrolls. Later routes can compose the same shell without depending on this demonstration content.

## Typography and font loading

Add `@fontsource/inter` and `@fontsource/jetbrains-mono` as application dependencies. Import their bundled CSS from `src/styles.css` so fonts are packaged into the build and never depend on runtime network access. The global sans stack starts with Inter and retains platform fallbacks; the mono stack starts with JetBrains Mono and retains monospace fallbacks. Font weights are loaded for the weights the token scale uses (regular, medium, semibold, bold, and extrabold for Inter; regular and medium for JetBrains Mono), avoiding a browser-synthesized bold where a packaged weight is available.

Body text uses the sans family. Prices, item counts, pickup numbers, and order IDs opt into the mono family through a utility/class or semantic component boundary. A browser test checks computed `font-family` for both a UI element and a numeric element, not merely stylesheet source text.

## Browser-first validation

Before the shell implementation, add `e2e/browser/design-system-shell.spec.ts` and run `bun run test:e2e`; the test must fail because the route does not yet render the required shell. The test then drives the built app and verifies observable behavior:

- a visible header landmark with the kiosk identity;
- a visible pinned bottom action bar while the content region has scrollable overflow;
- computed paper background and forest primary color;
- computed Inter on UI copy and JetBrains Mono on the numeric value;
- the shell remains a single viewport-height column with the bottom bar outside the scroll container.

After the implementation, the same Playwright test must pass. No colocated unit test is required because this spec introduces no non-trivial pure logic. The final repository checks include lint, formatting, typecheck, unit tests, and browser e2e.

## Implementation boundaries

This spec owns the global token stylesheet, shadcn configuration alignment, bundled font dependencies, shell component, representative index route, and its browser test. It does not add backend calls, kiosk claiming, menu/cart state, payment behavior, kitchen SSE, idle timers, analytics events, or additional page-specific components. Those later specs consume this shell and token vocabulary rather than creating parallel layout or color systems.
