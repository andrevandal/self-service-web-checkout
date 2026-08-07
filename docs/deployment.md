# Deployment topologies

The compose files describe database and app-tier boundaries; they do not
provision a reverse proxy, load balancer, or managed database. Choose one
topology for a deployment and keep its database URL and migration runner
consistent with that choice.

## Topology reference

| File | Database boundary | App-tier behavior | Persistent state and secrets |
| --- | --- | --- | --- |
| `docker-compose.yml` | The app container owns a file-mode SQLite/libSQL database at `/app/data/local.db`. | One app container, exposed on host port `3000`. | Named `local-data` volume; no secrets. |
| `docker-compose.sqld.yml` | A single internal `sqld` container is the database boundary. The app reaches it at `libsql://db:8080`. | One app container, exposed on host port `3000`. | Named `sqld-data` volume; no secrets. |
| `docker-compose.sqld-ha.yml` | The same single internal `sqld` container serves every app replica. | Scale only the app service with `--scale app=N`; the database remains one single point of failure. | Named `sqld-data` volume; no secrets. |
| `docker-compose.turso-ha.yml` | An externally managed Turso database supplies the database boundary and replication. | Scale app replicas with `--scale app=N`; each replica receives the external URL and token. | No database volume; `DATABASE_URL` and `DATABASE_AUTH_TOKEN` must be provisioned. |

The `sqld-ha` topology provides app-tier replication, not database high
availability. The `turso-ha` topology is the only one that delegates database
availability to an external service. The HA files expose only the container
port (`3000`), so an edge router or load balancer is required when callers
cannot address each replica directly.

## Starting a topology

Run these commands from the repository root:

```bash
docker compose -f docker-compose.yml up --build
docker compose -f docker-compose.sqld.yml up --build
docker compose -f docker-compose.sqld-ha.yml up --build --scale app=2
DATABASE_URL=libsql://your-turso-endpoint DATABASE_AUTH_TOKEN=... \
  docker compose -f docker-compose.turso-ha.yml up --build --scale app=2
```

Use only the command matching the selected topology; the examples are
alternatives, not a stack to run simultaneously.

## Migration boundary

Compose startup does not run schema migrations. The app runtime image starts
the built server with `bun run start`; it is not a migration runner: the
production install omits development dependencies, and the image copies
`dist` without the committed `drizzle/` migrations. Run migrations as a
separate release operation before app replicas receive traffic.

For the file-mode and internal `sqld` topologies, run the migration command
from a separate runner that can reach the selected database:

```bash
DATABASE_URL=... bun run db:migrate
```

For the internal `sqld` topologies, that runner must have access to the
compose `backend` network (for example, as a temporary compose service);
these compose files do not expose the database service to the host. The
file-mode topology persists its database in the `local-data` volume at
`/app/data`, so mount or otherwise target that database rather than assuming
the checkout's `.data` path is the mounted volume.

The current `drizzle.config.ts` uses drizzle-kit’s `sqlite` dialect. Its URL
setting can target the file-mode and internal `sqld` databases, but this
sqlite-dialect migration configuration does not forward
`DATABASE_AUTH_TOKEN` as Turso authentication. Do not use
`DATABASE_AUTH_TOKEN=... bun run db:migrate` as the Turso migration
procedure. Instead, apply the committed `drizzle/` migrations with a
separate migration runner or tool that explicitly supports Turso/libSQL
authentication, from an environment provisioned with the Turso credentials.

These files intentionally do not provide migration orchestration, rollback,
or edge routing. Plan those operations in the deployment environment.
