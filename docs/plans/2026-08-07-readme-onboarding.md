# README Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scaffold-oriented README copy with a concise onboarding guide for the Self-service web checkout kiosk concept.

**Architecture:** `README.md` remains the sole user-facing onboarding document. It leads with the kiosk checkout purpose and scenario, then gives a first-time contributor a minimal runnable setup and essential development commands. Detailed operational material remains behind one `docs/` link.

**Tech Stack:** Bun, TypeScript, TanStack Start, Drizzle/libSQL, Playwright, Docker Compose.

## Global Constraints

- Preserve only claims supported by the current repository.
- Do not describe a roadmap or unimplemented checkout features as available.
- Do not link plans or specifications from README.
- Keep one `docs/` link in Development; do not add UX-media placeholders.
- Keep existing status badges.

---

### Task 1: Rewrite project onboarding

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: current commands in `package.json`, environment defaults in `.env.example`, deployment guidance under `docs/`.
- Produces: an accurate first-time contributor guide with Purpose, Kiosk scenario, First-time setup, and Development sections.

- [ ] **Step 1: Replace scaffold positioning**

Replace the current scaffold-proof Concept section with a Purpose section that calls the repository a frictionless self-service checkout web app for kiosks. State that it is a showcase project and keep claims limited to implemented capabilities.

- [ ] **Step 2: Add the kiosk scenario**

Describe a customer using a kiosk to independently complete a checkout with clear, low-friction interaction. Do not list future implementation stages or imply unavailable payment, scanning, or receipt features exist.

- [ ] **Step 3: Consolidate first-time setup**

Keep the current `bun install`, environment-copy, migration, development-server, and health-check commands. State that `.env` is optional and retain current database URL and port defaults.

- [ ] **Step 4: Consolidate development guidance**

Keep essential development, database, test, quality, and deployment commands. Replace the multi-link Documentation section with one `[docs/](docs/)` link in Development. Remove agent-tooling, CI/release, plan, and specification sections from README.

- [ ] **Step 5: Verify Markdown formatting**

Run: `bun run format`

Expected: exit 0 and `All matched files use the correct format.`
