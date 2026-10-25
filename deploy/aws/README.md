# AWS EC2 demo deployment

This folder provides a **single-host Docker Compose deployment** for a portfolio demo. It has not been deployed or benchmarked. It is not production HA, autoscaling, RDS, ElastiCache, Secrets Manager, or a managed identity solution.

## Before you start

1. Provision an EC2 Linux instance with enough memory for PostgreSQL, Redis, Node API, worker and the web build (start with roughly 4 GB RAM; measure usage). Attach persistent EBS storage and configure backups/snapshots.
2. Configure a security group allowing SSH **only from your IP**, HTTP 80 and HTTPS 443 publicly. Do not expose 3000, 5432 or 6379. Use a key pair or SSM Session Manager for access.
3. Point a DNS A record for your domain to the instance's stable public address (prefer an Elastic IP). TLS certificates require a reachable domain and ports 80/443.
4. Install Git, Docker Engine and the Docker Compose plugin on the instance, and ensure the Docker daemon is running. Installation steps vary by AMI.
5. Clone the repository on EC2 and switch to the reviewed release branch.

## Deploy

```bash
git switch feature/complete-portfolio
cp deploy/aws/.env.example deploy/aws/.env
# Edit deploy/aws/.env: set your real domain, public origin and UNIQUE strong secrets.
docker compose --env-file deploy/aws/.env -f deploy/aws/compose.yml up --build -d
docker compose --env-file deploy/aws/.env -f deploy/aws/compose.yml ps
docker compose --env-file deploy/aws/.env -f deploy/aws/compose.yml logs --tail=100
```

Visit https://your-domain and enter the configured operator token. The web container serves the React build and reverse-proxies REST/WebSocket traffic to the private API. Caddy automatically obtains HTTPS certificates when DOMAIN is a valid public hostname and ports 80/443 are reachable. The database and Redis have no public port mappings in this Compose file.

To simulate robot traffic remotely, set API_URL to your HTTPS origin and INGEST_API_KEY to the configured ingestion secret on the **trusted simulator host**. Never place ingestion keys in browser code.

## Validate

- `curl -fsS https://your-domain/health` should return status ok.
- `curl -i https://your-domain/api/robots` should return 401 without a bearer token.
- Run the backend and frontend tests before deploying; run the simulator and verify charts and alerts after.
- Check `/api/ops/queue` with the operator bearer token to inspect Redis stream length, pending work and approximate lag.

## Important limits

This is a low-cost demonstration design with a single point of failure. PostgreSQL data lives on an EBS-backed Docker volume; add backups and a restore test. Redis AOF everysec can lose recent writes in a host crash. The stream is not automatically trimmed, so disk usage grows indefinitely. The overload guard uses approximate consumer lag and does not cap storage or guarantee admission control under concurrency. For production, migrate to RDS and ElastiCache, use ECS/Fargate or EKS, secrets management, proper user identity/RBAC, monitoring, rate limits, and verified retention/recovery policies. Protect your domain with TLS and never reuse the example credentials.
