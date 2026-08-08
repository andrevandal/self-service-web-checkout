# Kiosk claim/setup screen

## Contents

- [Goal](#goal)
- [User experience](#user-experience)
- [Architecture](#architecture)
- [States and error handling](#states-and-error-handling)
- [Accessibility and visual language](#accessibility-and-visual-language)
- [Verification](#verification)

## Goal

The root route is a session gate. When the tablet has no valid kiosk session, staff can authenticate with the shared setup password, select an existing kiosk to claim or reclaim, or create a new kiosk with a name and unique order prefix. A successful claim stores a signed server cookie; subsequent loads render kiosk mode directly without asking for the password again. A session-bearing root route continues to render the existing kiosk shell placeholder until the menu workflow replaces it in spec 3.

## User experience

The setup screen uses `KioskShell` so it retains the spec 1 header, scrollable content region, and pinned bottom bar. The header identifies the Warm & Melted setup flow rather than a kiosk that has not yet been selected. The content is a centered, touch-first card with:

1. A short heading, `Set up this kiosk`, and direct supporting copy explaining that setup is for staff.
2. A shared-password input and `Continue` action. The field is masked, has an explicit label, and supports Enter submission.
3. After successful password validation, a kiosk chooser appears in the same screen. It lists every existing kiosk as a large selectable card showing its name and order prefix, with a `Claim` action. The list may be empty; the create option remains available in either case.
4. A separate `Create a new kiosk` section with name and prefix inputs and a `Create kiosk` action. Prefix input is normalized to the server contract (trimmed and uppercased in the client) and still validated by the server.

The setup footer remains calm and useful: it communicates that the current tablet is not yet claimed and contains no customer ordering action. After either claim path succeeds, the route invalidates the session/query state and reloads the root gate so the signed cookie is observed and kiosk mode appears. No raw `/api/*` requests are introduced.

## Architecture

The root route owns the gate and renders one of two branches:

- **Unclaimed branch:** `KioskClaimScreen`, which owns local form fields and the password-to-chooser progression.
- **Claimed branch:** the existing kiosk-mode placeholder inside `KioskShell` (the future menu replaces this branch without changing the session boundary).

The UI calls a small local adapter, `src/lib/kiosk-session.ts`, rather than coupling components to the unfinished backend module. The adapter exposes typed async operations matching the backend contract:

- `getKioskSession()` reads the signed kiosk cookie and returns the current kiosk identity or `null`.
- `listKiosks()` returns all kiosk summaries.
- `claimKiosk({ password, kioskId })` claims/reclaims an existing kiosk.
- `claimKiosk({ password, name, prefix? })` creates and claims a new kiosk; the server derives a unique prefix when omitted.

The shared password is collected before the list is revealed and is submitted with the eventual claim/create mutation; `listKiosks()` itself is a read-only listing and does not validate the password.

The adapter is implemented as named `createServerFn` functions (or a single typed adapter around them) and is the only cross-layer boundary used by the route. Browser tests can inject an in-memory implementation through a test seam while still driving the built screen. When BackendPlatform-2 lands its stable signatures, this adapter swaps to those functions without changing the UI's state machine.

TanStack Query manages server state:

- Password submission reveals the chooser; `useQuery` calls `listKiosks()` once the password is non-empty and the chooser is active.
- Claim/create uses a mutation; the pending state disables duplicate taps and labels the action as busy.
- A successful mutation invalidates the session query and navigates/reloads `/` so the server-set signed cookie is used on the next render.

The setup UI does not read or write the cookie from client JavaScript. Cookie persistence and validity remain server responsibilities.

## States and error handling

The screen has explicit states rather than relying on disabled controls alone:

- Initial password form.
- Kiosk-list loading.
- Kiosk chooser with loading, populated, and empty-list presentations.
- Existing-kiosk claim pending.
- New-kiosk form with client-side required-field and prefix-shape feedback.
- Server rejection for an incorrect password, unknown kiosk, duplicate prefix, or invalid name/prefix; each error is shown inline near the relevant form and leaves entered values intact.
- Network/unexpected failure with a concise retry action.
- Successful claim transitions back through the root gate; the setup UI does not claim success until the mutation resolves.

A password is never placed in the URL, query key, analytics payload, or rendered text after submission. The list query only runs after the password gate is continued; the password remains local and is sent only with the claim/create mutation.

## Accessibility and visual language

Use the spec 1 tokens and Inter as the sole typeface, including kiosk prefixes and all numbers. Keep controls at least 48px tall, use visible labels and `:focus-visible` rings, preserve heading order, and expose loading/error feedback with `aria-live`. Kiosk cards are buttons (not clickable generic containers) with an unambiguous accessible name such as `Claim Kiosk 01, prefix A`. The form supports keyboard submission in addition to touch. Forest green is reserved for primary actions and the selected/active state; paper, cream, white, ink, border, and danger tokens provide the remaining surfaces and feedback.

## Verification

The first implementation artifact is a red Playwright browser test covering the complete observable flow: root setup display, password entry, existing-kiosk list, claiming an existing kiosk, creating a new kiosk, and a fresh load that enters kiosk mode without another password. The test uses the adapter's deterministic in-memory test seam and asserts user-visible text, controls, redirects/session behavior, and no duplicate submission. After implementation, run the focused browser test, then the repository's lint, format, typecheck, unit, build, and full e2e checks.
