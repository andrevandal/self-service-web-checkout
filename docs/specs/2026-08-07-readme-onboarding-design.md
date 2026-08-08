# README onboarding design

## Goal
Make `README.md` a concise, vision-led onboarding guide for the Self-service web checkout concept rather than a scaffold status document.

## Audience
New contributors and evaluators who need to understand the kiosk checkout use case, run the project locally, and find operational documentation.

## Content structure
1. **Purpose** — describe the project as a frictionless self-service checkout web app for kiosks.
2. **Kiosk scenario** — explain the intended customer-to-kiosk context without presenting an implementation roadmap or unbuilt functionality as available.
3. **First-time setup** — provide prerequisites, installation, environment setup, database migration, local startup, and a health verification command.
4. **Development** — retain the essential database and quality commands, and link once to [`docs/`](../) for deployment and contributor documentation.

## Constraints
- Remove scaffold-proof language.
- Do not link implementation plans or specifications from README.
- Do not create a UX-media section or placeholder media assets.
- Keep every command and currently implemented capability accurate.
- Preserve existing status badges and concise deployment/agent-tooling references only when they support first-time onboarding.

## Verification
- Run `bun run format` after editing Markdown.
- Follow the documented setup command sequence against the checked-out project; verify the health endpoint responds.