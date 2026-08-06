# Self-service web checkout (kiosk)

> In-progress by the user, don't change this file. If you need so, ask the user.

This is a small frictionless no-label self-service checkout web app for a snack bar.

## Essential user case

A customer walks up to a tablet mounted at the counter, browses the menu, builds an order, pays, and walks away. No cashier, just them and the screen.

### Tech UX

- The client lets someone see the menu (fetched from the API), build up an order, enter
payment, and submit it.
- The API serves the menu and accepts the order. Payment can be any shape you like and
does not need to be real or processed. Submitting an order just needs to persist it (file or DB,
your call) and return a sensible response.

## Ideias/Premisses

- Every instance deployed will be independent and run on a specific device adjusted for the software. This device will be a tabled linked to a wireless printed and pinpad (to credit card payment). Because of that, each instance will have an tag as identifier to be used as its order-prefix as we'll have a offline first approach (we'll trust that we could talk with pinpad and printer via bluetooth and the pinpad could have or not internet connection; for this POC, we'll just create a client-side layer pretending that we're asking these third-party devices to do something with an abstraction layer [just get a command, sleep someting (during tests we must skip all timers (fake timers) or set timers as off via env/var like a multiple from 0 to 1, accepting float to control the timer) because some timmed experiences like loadind state must be tested]).
- 

## Seed Menu (for demontration-only)

To enable testing the software, it has a seed command to add some items on the menu.
Once you had .env set, run:

```zsh
bun db:seed
```

Check all menu items on `./scripts/seed.ts`
