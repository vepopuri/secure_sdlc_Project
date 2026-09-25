# Running the whole platform from one container

One image contains everything:

```
browser ──> :3000  Next.js web app (sign-in, pages)
                    └─ /backend/*  ──>  FastAPI API (127.0.0.1:8000, internal)
                                          └─>  PostgreSQL (127.0.0.1:5432, data in /data)
```

Only port **3000** is exposed. The API and the database are not reachable from outside the
container. On first start the container initialises PostgreSQL, runs the migrations, loads the
seven framework definitions and generates an `AUTH_SECRET`. All of this persists in the `/data`
volume.

## 1. Quick start (your laptop or any server with Docker)

```bash
git clone https://github.com/vepopuri/secure_sdlc_Project.git
cd secure_sdlc_Project
docker compose up -d --build
```

Open <http://localhost:3000>. `docker compose` reads an optional `.env` file next to
`docker-compose.yml`. To try the app without setting up OAuth, create it with:

```bash
echo "ENABLE_DEV_LOGIN=true" > .env
docker compose up -d --build
```

Then sign in with any e-mail address. **Use the dev login only for private trials**: anyone who
can reach the site can sign in as anyone.

Without Compose:

```bash
docker build -t ssdlc .
docker run -d --name ssdlc -p 3000:3000 -v ssdlc-data:/data -e ENABLE_DEV_LOGIN=true ssdlc
docker logs -f ssdlc      # wait for "[ssdlc] Listening on http://0.0.0.0:3000"
```

### Pre-built image

Every push to `main` publishes `ghcr.io/vepopuri/secure_sdlc_project:latest` (workflow
`.github/workflows/docker.yml`). If the repository is private, the image is private too; log in
first with a GitHub personal access token that has `read:packages`:

```bash
echo <TOKEN> | docker login ghcr.io -u <github-user> --password-stdin
docker run -d -p 3000:3000 -v ssdlc-data:/data -e ENABLE_DEV_LOGIN=true ghcr.io/vepopuri/secure_sdlc_project:latest
```

## 2. Configuration

Everything is optional. Copy `docker/.env.example` to `.env` to start from a template.

| Variable | Purpose |
|---|---|
| `AUTH_URL` | Public URL of the site, e.g. `https://ssdlc.example.com`. Set it whenever you use OAuth behind a domain |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | GitHub sign-in. Callback URL: `<AUTH_URL>/api/auth/callback/github` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in. Redirect URI: `<AUTH_URL>/api/auth/callback/google` |
| `ENABLE_DEV_LOGIN` | `true` enables the e-mail login (trials only) |
| `ANTHROPIC_API_KEY` | Enables Claude analysis; without it the free keyword heuristic is used |
| `ANTHROPIC_MODEL` | Default `claude-opus-5` |
| `DATABASE_URL` | Use an external PostgreSQL (e.g. Neon) instead of the embedded one |
| `AUTH_SECRET` | Leave empty to auto-generate (saved in `/data/auth_secret`) |
| `PORT` | Listening port inside the container (default `3000`) |

Uploads of up to 25 MB go straight to the API; no Vercel Blob is needed. The logo slot
(`NEXT_PUBLIC_BRAND_LOGO`) is fixed at build time: `docker build --build-arg NEXT_PUBLIC_BRAND_LOGO=/brand/logo.svg .`
after placing the file in `frontend/public/brand/`.

## 3. Deploy to a container host

Any host that runs a Docker image with a **persistent disk** works. Three rules apply everywhere:

1. Expose container port **3000** over HTTPS.
2. Mount a persistent volume at **`/data`**. Without one, every restart starts from an empty database.
3. Set `AUTH_URL` to the public URL, plus at least one sign-in method.

**Render** (<https://render.com>)

1. Click **New → Web Service → Existing image**. Enter `ghcr.io/vepopuri/secure_sdlc_project:latest`, and add registry credentials if the image is private.
2. Instance type: at least 1 GB RAM. Port: `3000`.
3. Under **Advanced**, click **Add Disk** with mount path `/data` and size 1 GB.
4. Add the environment variables: `AUTH_URL=https://<service>.onrender.com`, plus OAuth and optionally `ANTHROPIC_API_KEY`.
5. Deploy. Health check path: `/backend/api/health`.

**Railway** (<https://railway.com>)

1. Click **New Project → Deploy from GitHub repo** and pick this repository. Railway builds the root `Dockerfile`.
2. Open the service → **Settings**. Under **Networking**, click **Generate Domain** with port `3000`.
3. Right-click the service and choose **Attach volume**, mounted at `/data`.
4. Under **Variables**, add `RAILWAY_RUN_UID=0` (Railway volumes are root-owned; the container fixes
   the ownership and then drops to the unprivileged `app` user), `AUTH_URL=https://<domain>`, and your
   sign-in variables.

**A plain VM** (any cloud)

1. Install Docker.
2. Run the `docker run` command from section 1 with `--restart unless-stopped`.
3. Put a TLS reverse proxy (Caddy, nginx) in front of port 3000.

## 4. Operations

- **Logs:** `docker logs -f ssdlc`. Lines prefixed `[ssdlc]` come from the startup script. PostgreSQL logs to `/data/postgres.log`.
- **Health:** `curl http://localhost:3000/backend/api/health` should return `{"status":"ok","database":"ok"}`.
- **Backup:** `docker exec ssdlc pg_dump -h 127.0.0.1 -U app ssdlc > backup.sql`
- **Restore** into a fresh volume: `cat backup.sql | docker exec -i ssdlc psql -h 127.0.0.1 -U app ssdlc`
- **Upgrade:** pull or build the new image and recreate the container with the same volume. Migrations run automatically on start.
- The container runs as the non-root user `app`, with `tini` as the init process. It stops, and your host restarts it, if the web server or the API exits.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in page says *No sign-in method is configured* | Set `ENABLE_DEV_LOGIN=true` (trial) or OAuth variables, then recreate the container |
| OAuth error *redirect_uri mismatch* | Set `AUTH_URL` to the exact public URL, and register `<AUTH_URL>/api/auth/callback/<provider>` with the provider |
| Data disappears after a restart | No persistent volume at `/data`; attach one |
| `[ssdlc] ERROR: /data is not writable by app` | The volume is root-owned. Start the container as root (`docker run --user 0 ...`, or `RAILWAY_RUN_UID=0` on Railway): the startup script fixes the ownership and then runs everything as the unprivileged `app` user. Or run `chown -R 10001:10001` on the volume once |
| Everybody is signed out after a redeploy | `/data` is not persistent (the generated `AUTH_SECRET` changed), or set a fixed `AUTH_SECRET` |
| Container keeps restarting | Check `docker logs ssdlc`: the startup script exits when the API or the web server stops, and prints the error first |
