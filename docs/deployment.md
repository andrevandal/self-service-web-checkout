# Deployment topologies

The compose files describe database and app-tier boundaries; they do not
provision a reverse proxy, load balancer, or managed database. Choose one
topology for a deployment and keep its database URL and migration runner
consistent with that choice.

The application image is runtime-only: it starts the built server and does not
provision, migrate, or seed a database. Before starting a topology, its
database must already be reachable, migrated, and seeded, and app secrets must
be supplied by the deployment environment.

## Topology reference

| File | Database boundary | App-tier behavior | Persistent state and secrets |
| --- | --- | --- | --- |
| `docker-compose.yml` | The app container owns a file-mode SQLite/libSQL database at `/app/data/local.db`. | One app container, exposed on host port `3000`. | Named `local-data` volume holds the database; app secrets are supplied at runtime. |
| `docker-compose.sqld.yml` | A single internal `sqld` container is the database boundary. The app reaches its HTTP endpoint at `http://db:8080`. | One app container, exposed on host port `3000`. | Named `sqld-data` volume holds the database; app secrets are supplied at runtime. |

Both topologies run exactly one `app` process; neither supplies app-tier or
database-tier high availability.

## Starting a topology

Run these commands from the repository root:

```bash
docker compose -f docker-compose.yml up --build
docker compose -f docker-compose.sqld.yml up --build
```

Use only the command matching the selected topology; the examples are
alternatives, not a stack to run simultaneously.

The compose examples require an initialized database and runtime app secrets;
they are topology references, not a zero-config first run.

## Migration boundary

Compose startup does not run schema migrations. The app runtime image starts
the built server with `bun run start`; it is not a migration runner: its
runtime stage contains `package.json` and the built `.output/` directory, not
`drizzle-kit` or the committed `drizzle/` migrations. Run migrations as a
separate release operation before the app receives traffic.

For the file-mode and internal `sqld` topologies, run the migration command
from a separate runner that can reach the selected database:

```bash
DATABASE_URL=... bun run db:migrate
```

For the internal `sqld` topology, that runner must have access to the
compose `backend` network (for example, as a temporary compose service);
the compose file does not expose the database service to the host. The
file-mode topology persists its database in the `local-data` volume at
`/app/data`, so mount or otherwise target that database rather than assuming
the checkout's `.data` path is the mounted volume.

These files intentionally do not provide migration orchestration, rollback,
or edge routing. Plan those operations in the deployment environment.
