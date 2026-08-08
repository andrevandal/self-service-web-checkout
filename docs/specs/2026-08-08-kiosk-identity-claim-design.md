# Kiosk identity and claim design

## Contents

- [Goal and scope](#goal-and-scope)
- [Design decisions](#design-decisions)
- [Kiosk data model](#kiosk-data-model)
- [Server-function contract](#server-function-contract)
- [Stateless cookie](#stateless-cookie)
- [Validation and errors](#validation-and-errors)
- [Testing and verification](#testing-and-verification)
- [Non-goals](#non-goals)

## Goal and scope

Add the kiosk identity boundary required before a tablet can enter kiosk mode. The
claim screen can list all known kiosks, staff can claim an existing kiosk or
create a new one, and the server returns a signed cookie that survives reloads.
The cookie is the only kiosk session state: no session table, heartbeat,
activity gate, reclaim lock, or revocation mechanism is introduced.

The PRD is authoritative. Claiming is gated by the shared
`KIOSK_CLAIM_PASSWORD`; kiosks contain only an id, display name, and unique
order prefix. This spec does not add order counters, checkout ownership, or
staff authentication.

## Design decisions

### Plain HttpOnly cookie for the HTTP-only POC

The deployment intentionally has no TLS-terminating reverse proxy, so
`KIOSK_COOKIE_SECURE` defaults to `false`. The cookie is therefore named
`kiosk_session` rather than using the `__Host-` prefix. Deployments with TLS
can set `KIOSK_COOKIE_SECURE=true` to add the `Secure` attribute without a code
change. The cookie always uses `HttpOnly`, `SameSite=Lax`, and `Path=/` so
browser JavaScript cannot read it and ordinary cross-site requests do not attach
it. It is a session cookie (no `Max-Age`) and is reissued on every successful
claim or reclaim.

### HMAC-SHA256 without an auth dependency

The cookie payload is a canonical JSON object containing only `{ kioskId,
issuedAt }`. The payload and a base64url HMAC-SHA256 signature are joined with a
period. `KIOSK_COOKIE_SECRET` is server-only and is never returned to the
client. Node's standard `crypto` module signs and verifies the token; verification
uses a timing-safe MAC comparison. This is signed, not encrypted: the kiosk id
and issue time are not treated as confidential.

### Existing claim versus creation

`kioskId` selects an existing row. When it is supplied, `name` and `prefix` are
ignored and the function returns the selected row. When it is absent, `name` is
required and `prefix` is optional. A supplied prefix is trimmed, uppercased, and
validated as one to five ASCII letters/digits. If omitted, the server derives
the shortest available prefix from the normalized name, then tries a numeric
suffix within five characters. The database unique index remains authoritative
for races and duplicate supplied prefixes.

### Operator-trust limitation

Reclaiming does not revoke another tablet's cookie and does not lock a kiosk.
Two tablets can therefore use one kiosk prefix, as explicitly accepted by the
PRD for this small POC fleet.

## Kiosk data model

`kiosks` is a standalone table with text UUID-style ids, `name TEXT NOT NULL`,
and `prefix TEXT NOT NULL UNIQUE`. There are no `daily_order_sequence`,
`is_online`, `last_heartbeat`, or session columns. The migration creates the
unique prefix index and leaves the table empty; kiosk creation happens through
the claim function.

Responses use this stable public shape:

```ts
type Kiosk = {
  id: string;
  name: string;
  prefix: string;
};
```

Kiosk rows are listed deterministically by `name`, then `id`.

## Server-function contract

The application boundary is two named TanStack Start server functions. No
ad-hoc `/api/*` endpoint is added.

```ts
export const listKiosks = createServerFn({ method: "GET" }).handler(
  async (): Promise<Kiosk[]> => {
    // Return every kiosk ordered by name, then id.
  },
);

type ClaimKioskInput = {
  password: string;
  kioskId?: string;
  name?: string;
  prefix?: string;
};

export const claimKiosk = createServerFn({ method: "POST" })
  .validator((input: ClaimKioskInput) => input)
  .handler(async ({ data }): Promise<Kiosk> => {
    // Validate the shared password, select/create the row, and set the cookie.
  });
```

TanStack callers pass the input as `claimKiosk({ data: input })`; the handler
receives the exact `ClaimKioskInput` above. `listKiosks()` takes no data. A
successful claim returns the selected or newly created `Kiosk` and emits the
signed `kiosk_session` cookie in the response.

## Stateless cookie

The cookie value is:

```text
base64url(JSON.stringify({ kioskId, issuedAt })).base64url(HMAC-SHA256(payload, secret))
```

`issuedAt` is a server-generated Unix timestamp in milliseconds. The signing
helper owns canonical serialization, base64url encoding, signing, verification,
and parsing of the cookie header. It rejects malformed tokens, invalid JSON,
missing/invalid fields, and signatures that do not match. It does not query the
database; callers that need a live kiosk must perform that lookup separately.

A successful claim sets:

```text
kiosk_session=<token>; HttpOnly; SameSite=Lax; Path=/
```

and adds `; Secure` when `KIOSK_COOKIE_SECURE=true`.

`KIOSK_CLAIM_PASSWORD` gates both existing-kiosk reclaim and new-kiosk
creation. `KIOSK_COOKIE_SECRET` signs and verifies the cookie, while
`KIOSK_COOKIE_SECURE` controls the optional transport flag and defaults to
`false`. These are server-only environment fields; an unset gate or secret
produces a clear configuration error rather than silently issuing an unsigned
cookie.

## Validation and errors

The handler trims the password only for presence validation and compares the
provided value to the configured value without early-exit string comparison.
A wrong password always throws `KioskClaimError` with code `invalid_password`.

Other typed errors are:

- `configuration`: the claim password or cookie secret is not configured;
- `invalid_input`: a creation name/prefix is missing or malformed;
- `kiosk_not_found`: an existing `kioskId` does not exist;
- `prefix_taken`: a requested prefix violates the unique constraint.

Database errors unrelated to the known uniqueness case propagate unchanged.
No error returns a cookie or partially-created kiosk.

## Testing and verification

The colocated test creates an isolated `file::memory:` database containing the
kiosks table, mocks `#/db/client.server` and the server environment before the
module import, and invokes the extracted handlers in a mocked TanStack Start
context. The response-header setter is captured so the test can assert cookie
flags and token verification without making a network request.

The first test version is run before the schema, cookie helper, and handlers
exist to record a real red phase. Passing assertions cover deterministic kiosk
listing, wrong-password rejection, existing-kiosk reclaim, new-kiosk creation
with derived and supplied prefixes, duplicate-prefix rejection, response cookie
flags, HMAC tamper rejection, and the stateless payload fields. Final checks
are run once after implementation:

```bash
bun run lint && bun run format && bun run typecheck && bun run test
```

## Non-goals

This spec does not add a session table, heartbeat endpoint, inactivity timeout,
reclaim locking, revocation list, logout flow, staff cookie, order numbering,
checkout authorization, or an HTTP kiosk identity route. It also does not
encrypt the cookie payload or add a JWT/authentication library.
