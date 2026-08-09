# Take-Home Readiness Design

Date: 2026-08-09
Status: Approved for planning

## Contents

- [Purpose](#purpose)
- [Goals](#goals)
- [First-time local setup](#first-time-local-setup)
- [Container runtime contract](#container-runtime-contract)
- [Architecture and production boundaries](#architecture-and-production-boundaries)
- [Go-live requirements](#go-live-requirements)
- [Documentation structure](#documentation-structure)
- [Verification](#verification)
- [Out of scope](#out-of-scope)

## Purpose

Make the repository credible as a take-home submission: an evaluator can clone it,
start a working kiosk without discovering hidden prerequisites, and understand the
engineering decisions, production topology, and deliberate limits without mistaking
POC conveniences for production guarantees.

## Goals

- Make the documented local first-run path create a usable catalog and permit kiosk
  and staff flows with development-only sample configuration.
- Describe a container as an application runtime connected to an already operational
  database, not as database provisioning or deployment automation.
- Make architectural decisions and production work explicit in the README.
- Preserve the single-container-per-restaurant topology as a production-valid initial
  deployment model.

## First-time local setup

The README must provide a linear, copy-pasteable local sequence:

1. Install Bun.
2. Copy `.env.example` to `.env`.
3. Run migrations.
4. Seed the catalog.
5. Start the development server.

`.env.example` must contain clearly labelled development-only kiosk/staff passwords
and cookie secrets, plus the existing local SQLite URL and non-secure cookie flags.
The README must say that deployment values, especially credentials, cookie security,
and the database URL, must be replaced for the target environment. Development
values are for a local evaluator and must not be presented as deployable secrets.

## Container runtime contract

README container guidance must show how to run the application image with its runtime
environment and a persistent, reachable database. It must state that the database is
already created, migrated, and seeded before the container is started.

The container remains responsible only for serving application traffic and health
checks. It does not acquire credentials, provision storage, apply migrations, seed
catalog data, or create a backup policy at application startup.

## Architecture and production boundaries

Add a concise README section that states:

- TanStack server functions are the typed client/API boundary for this application.
- The terminal is deliberately simulated: it models payment-attempt correlation and
  reconciliation, not card capture, PCI compliance, or a payment-provider contract.
- Each restaurant runs one application container. Its many kiosk and staff browser
  sessions share one process and its in-process kitchen event dispatcher.
- In-process kitchen events are appropriate for that single-container restaurant
  topology. A shared pub/sub transport becomes necessary only when one restaurant
  needs multiple application instances, not when it adds kiosks.
- PostHog, kitchen workflow, and Docker support are optional extensions around the
  core menu/order/payment assignment flow.

## Go-live requirements

Before production deployment, an operator must provide and verify:

- a managed or otherwise durable database with a migration procedure before release;
- catalog seeding or catalog-management ownership;
- unique, rotated application and cookie secrets;
- secure cookies, TLS termination, and trusted proxy configuration;
- persistent data storage, backups, restore exercises, and retention expectations;
- health monitoring, alerting, and operational logs;
- a real payment-provider and PCI/compliance design if payments leave simulation;
- shared event transport only when horizontally scaling a single restaurant.

This is a production readiness boundary list, not an implementation commitment in the
take-home scope.

## Documentation structure

Keep evaluator-facing information in `README.md`:

- first-time setup and container runtime instructions near existing run guidance;
- the architecture/production-boundaries section after development guidance;
- the go-live requirements as a compact, explicit subsection.

Do not create a separate take-home document. The primary README is the required entry
point for a teammate cloning the repository.

## Verification

- Exercise the documented fresh local sequence against an empty local database and
  verify the rendered menu is populated.
- Run the app and complete the documented kiosk path with sample development values.
- Verify the documented container command starts against an already working database
  and exposes the health endpoint.
- Run lint, format, typecheck, unit tests, build, and the affected browser tests.

## Out of scope

- Container-startup migration or seeding automation.
- Database provisioning, backup implementation, TLS/reverse-proxy configuration, or
  real payment-provider integration.
- Horizontal multi-instance event transport.
- UI polish backlog work tracked by the separate `kiosk-polish` goal.
