# Deployment notes

Cap-It is prepared for a Vercel frontend and two Render API services. The API instances must use the same managed Redis URL so their token buckets remain shared.

## Vercel frontend

Create the Vercel project from the **repository root**. The npm workspace lockfile and build command live there.

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Root directory | `.` (repository root) |
| Install command | `npm ci` |
| Build command | `npm run build --workspace=web` |
| Output directory | `apps/web/dist` |

Set these environment variables for the Vercel Production environment, then redeploy so Vite bakes the values into the frontend bundle:

| Variable | Value |
| --- | --- |
| `VITE_API1_URL` | Public base URL of the first Render API service, such as `https://cap-it-api1.onrender.com` |
| `VITE_API2_URL` | Public base URL of the second Render API service, such as `https://cap-it-api2.onrender.com` |
| `VITE_SITE_URL` | The public Vercel/custom domain origin used for canonical URLs and the sitemap |

These `VITE_` values are public. Never put `CAPIT_API_KEY`, `REDIS_URL`, or `METRICS_BEARER_TOKEN` in Vercel. Leave the API URLs blank for local development; Vite will keep proxying `/api/api1` and `/api/api2` to local ports 3000 and 3002.

## Render API services

Create two Render **Web Services** from the same repository and branch. Use Docker, the repository root as the Docker context, and the root `Dockerfile`. Do not set a different start command; the image starts the API with `npm run start`. Set a health check path of `/health`.

Render supplies `PORT` (normally `10000`). The server binds to `0.0.0.0` and uses that value. Set the following on both API services:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `CAPIT_API_KEY` | A strong API key shared by both API services and supplied by users in Playground |
| `REDIS_URL` | The managed Redis provider's private/internal `redis://` or `rediss://` connection URL |
| `FRONTEND_ORIGINS` | Exact comma-separated production frontend origins, with no paths or trailing slash, e.g. `https://cap-it.vercel.app,https://cap-it.example.com` |
| `METRICS_BEARER_TOKEN` | A separate high-entropy secret for Prometheus scraping `/metrics` |

Set `INSTANCE_ID=api1` on the first service and `INSTANCE_ID=api2` on the second. Do not set `PORT` manually unless you intentionally override Render's assigned port. Generate `CAPIT_API_KEY` and `METRICS_BEARER_TOKEN` as separate random secrets and keep them in Render's environment settings. The API validates all four required production values at startup.

Add every production Vercel/custom domain origin to `FRONTEND_ORIGINS` on both services. Origins are exact matches, including the scheme; wildcard origins and paths are rejected. Vercel preview domains are not implicitly trusted: add a specific preview origin only when you intend to allow it.

`PROMETHEUS_URL` is optional. If omitted, API analytics will not have a reachable Prometheus service. If you deploy Prometheus, keep it private and set this variable to its private service URL. Configure its scrape job to use the same `METRICS_BEARER_TOKEN` as the API services. Do not publish Prometheus or Grafana publicly without separate access controls.

Redis must remain private and shared by both APIs. Do not publish a Redis port to the public internet. The local Compose file keeps Redis on its private network and binds the API, Prometheus, and Grafana host ports to loopback.

The k6 load-runner is for local development. The hosted Playground does not call it; run the copied k6 command from your own machine instead. Do not deploy the runner as a public service without a proper authentication and job-isolation design.

## Local checks

Copy `.env.example` to `.env`, set a local-only `CAPIT_API_KEY`, then run:

```powershell
npm ci
docker run --rm --name cap-it-test-redis -p 127.0.0.1:6379:6379 -d redis:7-alpine
npm test
npm run typecheck
npm run typecheck --workspace=web
npm run build --workspace=web
docker build -t cap-it-api .
docker stop cap-it-test-redis
```

The Redis integration test needs a Redis server at `REDIS_URL` (defaults to `redis://localhost:6379`). These checks build and verify the code locally; they do not deploy services or configure hosting accounts.
