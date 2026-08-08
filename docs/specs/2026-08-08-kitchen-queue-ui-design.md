# Kitchen queue UI design

## Contents

- [Context and goals](#context-and-goals)
- [Design decisions](#design-decisions)
- [Architecture and data flow](#architecture-and-data-flow)
- [Screen and interactions](#screen-and-interactions)
- [Errors and connection state](#errors-and-connection-state)
- [Testing](#testing)
- [Out of scope](#out-of-scope)

## Context and goals

The `/kitchen` route is a staff-only active-order queue for Warm & Melted. It lets staff enter the shared password once, load `paid` and `preparing` orders, move orders through `paid → preparing → done`, and see newly paid orders without a manual refresh. The staff session is a separate signed `staff_session` cookie authority; the customer-facing `kiosk_session` is never read or reused.

The product requirements make the TanStack Query cache the queue source of truth under `['kitchen', 'orders']`. Initial loading and Refresh use the named server-function seam. The one transport exception is `EventSource('/api/kitchen/events')`; its handlers patch that Query cache directly.

## Design decisions

- Use the existing paper background, Inter face, forest-green accent, border, radius, and shadow tokens for visual consistency.
- Use a simpler staff header and denser responsive layout than the customer kiosk shell. Cards use one column on narrow screens and two columns on wider screens. Staff does not need the customer-facing 48px touch-target constraint, but controls remain comfortably keyboard and pointer accessible.
- Use approach A: the screen starts in a password gate, calls `claimStaffSession`, then enables the queue query. There is no `getStaffSession` contract, so a query error caused by an expired or missing staff cookie returns the screen to the gate rather than inventing a second session API.
- Let native EventSource reconnection work without a custom retry flow. Show a compact `Live updates on`/`Live updates off` label beside Refresh so staff can understand whether automatic updates are currently connected.
- Keep the local server-function-shaped seam intentionally small and directly replaceable with the backend-platform exports when merged.

## Architecture and data flow

`src/lib/kitchen.ts` owns the client-visible types and local seam:

- `claimStaffSession({ data: { password } }): Promise<{ issuedAt: number }>` sets a separate HttpOnly, SameSite=Lax, Path=/ `staff_session` cookie in the local adapter.
- `listActiveOrders(): Promise<KitchenOrder[]>` requires the local staff session and returns `paid` and `preparing` fixture orders oldest-first with immutable item, variant, and addon snapshots.
- `advanceOrder({ data: { orderId, toStatus: "preparing" | "done" } }): Promise<OrderStatusEvent>` enforces only `paid → preparing → done` and requires the staff session.
- Typed errors use the backend contract codes: `configuration`, `invalid_password`, `invalid_input`, `staff_identity`, `order_not_found`, and `invalid_transition`.

`src/routes/kitchen.tsx` renders the route and `src/components/kitchen-screen.tsx` owns the screen state. The password form is local state. A successful claim enables `useQuery({ queryKey: ["kitchen", "orders"], queryFn: listActiveOrders })`; the query is disabled while the gate is shown. A list/advance `staff_identity` error clears the local ready state and shows the password gate on the next render.

Once staff-ready, an effect opens `new EventSource('/api/kitchen/events')` and cleans it up on unmount or when staff-ready changes. The EventSource is not a TanStack Query transport. Handlers use `queryClient.setQueryData`:

- `order.paid` upserts the full `event.order` by ID, preserving oldest-first order for a new ID.
- `order.preparing` updates the matching order's status to `preparing`.
- `order.done` removes the matching order from the active list.

The Refresh button calls `queryClient.invalidateQueries({ queryKey: ["kitchen", "orders"] })`; the active query then refetches through `listActiveOrders`. Mutation success also patches the cache from the returned status event, so the action feels immediate while the server remains authoritative.

For browser coverage, the local adapter exposes a test-only window helper that dispatches an SSE payload through the same event handler. It is not used by production UI behavior and is removed or replaced by the real `/api/kitchen/events` integration when the backend seam is swapped.

## Screen and interactions

The unauthenticated screen has a compact staff header and a centered password card:

- heading: `Kitchen queue`;
- supporting copy: `Enter the shared staff password to view active orders`;
- password field and `Continue` action;
- inline validation for an empty password and typed claim failures.

The authenticated screen header shows `Kitchen queue`, a compact connection status, and `Refresh`. The queue body has these states:

- loading: a short loading message;
- error: a retry-safe message with Refresh still available;
- empty: `No active orders` and the next-step hint `New paid orders will appear here`;
- loaded: responsive order cards in oldest-first order.

Each card shows the order number prominently, a `Paid` or `Preparing` status badge, created time, subtotal/total where available, and every item snapshot. Item rows include quantity, product name, unit price, and nested variant/addon names with price deltas when present. A paid card has `Start preparing`; a preparing card has `Done`. Done orders disappear from the cache and therefore from the view.

Buttons are disabled while their own mutation is pending, preventing duplicate transitions. A mutation failure leaves the card in place and shows a concise inline error; the staff can retry the same legal action.

## Errors and connection state

Typed seam errors map to calm, direct copy:

- `invalid_password`: `That staff password is not correct.`
- `configuration`: `Kitchen setup is temporarily unavailable. Try again.`
- `invalid_input`: `Enter the staff password to continue.`
- `staff_identity`: `Your staff session has expired. Enter the password again.`
- `order_not_found`: `That order is no longer active. Refresh the queue.`
- `invalid_transition`: `That order changed on another screen. Refresh the queue.`

Unknown errors use a generic retry message and never expose cookie, password, or transport details. An EventSource `open` event sets the live label to `Live updates on`; an `error` event sets it to `Live updates off` while native EventSource reconnection remains enabled. Refresh is the only explicit recovery action required for this POC.

## Testing

The first implementation test is a Playwright browser flow against the built app:

1. Open `/kitchen`, enter the fixture staff password, and submit.
2. Assert the fixture paid order and its item/customization snapshots render.
3. Select `Start preparing`, assert the status/action change to `Preparing`/`Done`.
4. Select `Done`, assert the order leaves the active queue.
5. Use the local adapter's test-only SSE injection helper to publish another paid order and assert it appears without clicking Refresh.

The test must be red before the route and implementation exist. Pure cache-event transformations and any test-only adapter helper can have colocated unit coverage, but the screen contract is covered by the browser test. Run the required focused checks while iterating, then the repository's full lint, format, typecheck, unit, and end-to-end checks before the final commit.

## Out of scope

- Customer kiosk session reuse or a shared authority between kiosk and staff cookies.
- Editing orders, cancelling orders, inventory, out-of-stock state, sound alerts, printer hardware, or offline-first queueing.
- A custom SSE retry UI, polling loop, or a second staff-session lookup endpoint.
- Any raw `fetch` call other than the explicitly required EventSource SSE subscription.
