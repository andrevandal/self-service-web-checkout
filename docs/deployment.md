# Deployment topologies

Choose a compose file according to the database boundary and the amount of app-tier scaling required:

| File | Use case | Availability boundary | Required secrets |
| --- | --- | --- | --- |
| `docker-compose.yml` | Local or single-host deployment with an embedded file-mode database | One app container and one named-volume SQLite/libSQL database | None |
| `docker-compose.sqld.yml` | Single app instance with a separate internal sqld service | App and database are separate containers; the single sqld service is the database boundary | None |
| `docker-compose.sqld-ha.yml` | Scale app replicas against one internal sqld service | App tier scales with `docker compose up --scale app=N`; the single sqld service remains one database single point of failure | None |
| `docker-compose.turso-ha.yml` | Scale app replicas against an externally managed Turso database | App tier scales locally while database availability and replication are provided by Turso Cloud | Externally provisioned `DATABASE_URL` and `DATABASE_AUTH_TOKEN` |

The `sqld-ha` topology scales only app replicas. Its one sqld database container is a single point of failure for every replica. The `turso-ha` topology requires externally provisioned Turso credentials before starting app replicas.

These compose files do not supply a reverse proxy, load balancer, or migration orchestration. Run schema migrations as an explicit deployment operation rather than as container boot behavior; the image starts only the built application server.
