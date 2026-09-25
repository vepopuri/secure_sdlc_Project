# Deploying to Vercel (Hobby, free tier)

The repository deploys as **two Vercel projects** from the same GitHub repository:

| Vercel project | Root Directory | Framework Preset | What it serves |
|---|---|---|---|
| `ssdlc-api` | `backend` | **Other** | FastAPI as a Python function (`backend/vercel.json` + `backend/api/index.py`) |
| `ssdlc-web` | `frontend` | **Next.js** | The web app, Auth.js sign-in, Blob upload tokens |

The database is **Neon Postgres** (free tier). Everything below fits the free tiers of Vercel
Hobby, Neon and GitHub Actions. Budget about 30 minutes.

```
Browser ──(session cookie)──> ssdlc-web (Next.js) ──/api/token──> 15-min HS256 JWT
Browser ──(Bearer JWT)──────> ssdlc-api (FastAPI) ──> Neon Postgres
Browser ──(large files)─────> Vercel Blob ──(allow-listed URL)──> ssdlc-api
```

---

## 0. Before you start

You need:

- The repository on GitHub (pushed to `main`).
- A Vercel account on the **Hobby** plan, signed in with GitHub.
- A Neon account (<https://console.neon.tech>).
- Optional: an Anthropic API key (<https://console.anthropic.com>) for Claude analysis. Without
  it the app uses the free keyword heuristic.

Generate one shared secret. **Both projects must use exactly the same value**:

```bash
openssl rand -base64 32
```

Keep it somewhere safe; it is referred to as `AUTH_SECRET` below.

---

## 1. Create the Neon database

1. Open <https://console.neon.tech> and click **New Project**.
2. Name it `ssdlc`, pick the region closest to your Vercel functions (Vercel defaults to
   Washington, D.C. `iad1`, so choose **AWS US East**), and click **Create project**.
3. On the project dashboard click **Connect**.
4. Turn **Connection pooling** on (the host contains `-pooler`). Pooled connections suit
   serverless functions.
5. Copy the connection string. It looks like
   `postgresql://user:password@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require`.
   Any `postgres://` or `postgresql://` URL works: the API normalises it to the psycopg 3 driver.

This is your `DATABASE_URL`.

## 2. Run the migrations (GitHub Actions "DB migrate")

1. In GitHub open your repository, then **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**. Name: `DATABASE_URL`, value: the Neon string. Click **Add secret**.
3. Open the **Actions** tab, select **DB migrate** in the left sidebar, click **Run workflow**, keep
   branch `main`, and click the green **Run workflow** button.
4. Wait for the green tick. The log ends with `Seeded 7 frameworks and 32 capabilities` and the
   current revision (`0002 (head)`).

The workflow also runs automatically whenever migrations or framework YAML files change on `main`.

## 3. Deploy the API (`ssdlc-api`)

1. On <https://vercel.com/new> click **Import** next to your repository.
2. **Project Name**: `ssdlc-api`.
3. **Framework Preset**: open the dropdown and choose **Other**.
4. **Root Directory**: click **Edit**, select `backend`, click **Continue**.
5. Leave Build and Output Settings empty (Vercel reads `backend/vercel.json`, installs
   `requirements.txt` and uses Python from `.python-version`).
6. Expand **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `AUTH_SECRET` | the shared secret |
   | `CORS_ORIGINS` | `https://ssdlc-web.vercel.app` (placeholder: fixed in step 5) |
   | `APP_ENV` | `production` |
   | `ANTHROPIC_API_KEY` | optional: your key |
   | `ANTHROPIC_MODEL` | optional: default `claude-opus-5` |

7. Click **Deploy**.
8. When it finishes, click the domain (for example `https://ssdlc-api.vercel.app`). You should see:

   ```json
   {"service":"ssdlc-assessment-api","status":"ok","version":"1.0.0","health":"/api/health","docs":"/api/docs"}
   ```

   `https://ssdlc-api.vercel.app/api/health` should return `"database": "ok"`.

## 4. Deploy the web app (`ssdlc-web`)

1. Go to <https://vercel.com/new> again and import the **same** repository.
2. **Project Name**: `ssdlc-web`.
3. **Framework Preset**: **Next.js** (usually detected automatically once the root is set).
4. **Root Directory**: click **Edit**, select `frontend`, click **Continue**.
5. Environment Variables:

   | Name | Value |
   |---|---|
   | `AUTH_SECRET` | the **same** shared secret as the API |
   | `NEXT_PUBLIC_API_URL` | the API URL from step 3, no trailing slash, e.g. `https://ssdlc-api.vercel.app` |
   | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | from step 6 (you can add them after the first deploy) |
   | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from step 6 (optional) |
   | `NEXT_PUBLIC_BRAND_LOGO` | optional, e.g. `/brand/logo.svg` (see `frontend/public/brand/README.md`) |

6. Click **Deploy** and note the production domain, e.g. `https://ssdlc-web.vercel.app`.

> `NEXT_PUBLIC_*` variables are baked in at build time. After changing one, redeploy the project.

## 5. Point CORS at the web app

1. Open the **ssdlc-api** project → **Settings → Environment Variables**.
2. Edit `CORS_ORIGINS` to the exact web origin, e.g. `https://ssdlc-web.vercel.app`
   (scheme + host, **no trailing slash**; separate several origins with commas).
3. Open **Deployments**, click the **⋯** menu on the latest deployment → **Redeploy** → **Redeploy**.

## 6. Configure sign-in (OAuth)

The callback URL pattern is `https://<web domain>/api/auth/callback/<provider>`.

**GitHub**

1. GitHub → your avatar → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Application name `SSDLC Assessment`; Homepage URL `https://ssdlc-web.vercel.app`;
   Authorization callback URL `https://ssdlc-web.vercel.app/api/auth/callback/github`.
3. Click **Register application**, then **Generate a new client secret**.
4. Copy the Client ID into `AUTH_GITHUB_ID` and the secret into `AUTH_GITHUB_SECRET` on **ssdlc-web**.

**Google** (optional)

1. <https://console.cloud.google.com> → **APIs & Services → OAuth consent screen**: configure an
   External app (app name, support e-mail) and publish it or add test users.
2. **Credentials → Create credentials → OAuth client ID**, type **Web application**.
3. Authorized JavaScript origins: `https://ssdlc-web.vercel.app`.
   Authorized redirect URIs: `https://ssdlc-web.vercel.app/api/auth/callback/google`.
4. Copy the values into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` on **ssdlc-web**.

Redeploy **ssdlc-web** after adding the variables. The first person to sign in gets their own
organization as **admin** and can invite colleagues (with roles) from **Settings**.

## 7. Large uploads (Vercel Blob)

Vercel functions accept request bodies up to about 4.5 MB. Larger files go straight from the
browser to Vercel Blob:

1. Open **ssdlc-web** → **Storage** → **Create Database** → **Blob** → name it `ssdlc-evidence` → **Create**.
2. Connect it to the `ssdlc-web` project for all environments. Vercel adds `BLOB_READ_WRITE_TOKEN`.
3. Redeploy **ssdlc-web**.

The API only downloads from hosts ending in `.public.blob.vercel-storage.com`
(`BLOB_ALLOWED_HOSTS`), without following redirects, which prevents SSRF. The browser deletes
each blob right after the API has ingested it.

## 8. Smoke test (definition of done)

On `https://ssdlc-web.vercel.app`:

1. **Sign in** with GitHub or Google.
2. **New engagement** → fill in client, application and scope, pick e.g. OWASP SAMM and NIST SSDF → **Create engagement**.
3. **Evidence** → upload `samples/acme-secure-sdlc-overview.md` and add an interview note (try
   an e-mail address and a phone number: they are redacted).
4. **Analysis** → **Run analysis** and watch the domains complete.
5. **Results** → toggle between SAMM, SSDF and the "Also view" frameworks (projected).
6. Open a practice card → **Override score** → enter a score and reason → **Save override**.
7. **Report** → **Download PowerPoint**. **Activity** shows every step.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser console: *blocked by CORS policy: No 'Access-Control-Allow-Origin' header*; UI shows "Cannot reach the API" | `CORS_ORIGINS` on the API does not exactly match the web origin (trailing slash, `http` vs `https`, preview vs production domain) | Set `CORS_ORIGINS` on **ssdlc-api** to the exact origin, e.g. `https://ssdlc-web.vercel.app` (comma-separate extra origins such as a custom domain), then **Redeploy** the API |
| Every API call returns **401 Invalid token** right after signing in | `AUTH_SECRET` differs between the two projects (or has stray whitespace/quotes) | Paste the identical value into both projects, redeploy **both**, then sign out and in again |
| API returns **500** and `/api/health` shows `"database": "unavailable"`, or errors mention `relation "engagements" does not exist` | Migrations have not run against this database | Add the `DATABASE_URL` repository secret and run **Actions → DB migrate → Run workflow**; make sure it is the same database the API uses |
| GitHub shows *The redirect_uri is not associated with this application*; Google shows **Error 400: redirect_uri_mismatch** | OAuth callback URL does not match the deployed domain | Set the callback to `https://<web domain>/api/auth/callback/github` (or `/google`) exactly; add a separate OAuth app or URI for each extra domain |
| Visiting a project URL shows Vercel's **404: NOT_FOUND** page (`Code: NOT_FOUND`) | Wrong **Root Directory** or **Framework Preset** (e.g. API project built with Next.js preset, or root left at the repository root, so nothing is deployed at `/`) | Project → **Settings → Build and Deployment**: API = Root Directory `backend`, Framework Preset **Other**; web = Root Directory `frontend`, Framework Preset **Next.js**. Save, then **Redeploy** |
| Deployment is **Blocked** / *"The Deployment was blocked because the commit author does not have contributing access to the project on Vercel"* (Hobby plan) | Hobby teams have a single member; commits authored by anyone else (a collaborator, a bot, or an AI coding agent such as `Claude <noreply@anthropic.com>`) are not deployed from private repositories | Push a commit authored by the GitHub account connected to your Vercel account, e.g. `git commit --allow-empty -m "Trigger deploy"` after setting `git config user.email` to your own address; or deploy with a **Deploy Hook** (Project → Settings → Git → Deploy Hooks) or `vercel --prod` from the CLI; or make the repository public; or upgrade to Pro and add the author to the team |
| Sign-in page says *No sign-in method is configured* | No OAuth variables on **ssdlc-web** (the dev login is always disabled on Vercel by design) | Add `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` (and/or Google) and redeploy |
| Auth.js error `UntrustedHost` when running `next start` yourself | Outside Vercel, Auth.js needs to be told the host is trusted | Set `AUTH_TRUST_HOST=true` (not needed on Vercel) |
| Uploads over 4 MB fail with *Files over 4 MB need Vercel Blob* | No Blob store connected | Complete step 7 and redeploy the web app |
| Analysis domain fails with *Claude API rate limit reached* or times out | API tier limits or a very large evidence set | Click **Retry failed domains**; lower `EVIDENCE_CHAR_BUDGET` or raise your Anthropic rate limits |
| `NEXT_PUBLIC_API_URL` change has no effect | `NEXT_PUBLIC_*` values are inlined at build time | Redeploy **ssdlc-web** after changing it |

Useful checks:

```bash
curl -s https://ssdlc-api.vercel.app/            # {"status":"ok",...}
curl -s https://ssdlc-api.vercel.app/api/health  # {"database":"ok",...}
curl -si -X OPTIONS https://ssdlc-api.vercel.app/api/engagements \
  -H "Origin: https://ssdlc-web.vercel.app" -H "Access-Control-Request-Method: GET" | grep -i access-control
```
