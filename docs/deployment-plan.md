# Deployment Plan: Google Workspace MCP on Vercel

Plan for hosting this MCP server on [Vercel](https://vercel.com) so Cursor (or other MCP clients) can call `send_email` and `append_to_google_doc` over HTTPS.

**Related docs:** [`problemstatement.md`](./problemstatement.md) · [`architecture.md`](./architecture.md) · [`implementation-plan.md`](./implementation-plan.md)

**Vercel references:** [Deploy MCP servers to Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel) · [MCP on Vercel](https://vercel.com/docs/mcp)

---

## 1. Reality check

The original MVP is a **local stdio** process. Remote use needs **Streamable HTTP**.

| Local (default) | Hosted on Vercel |
|---|---|
| Transport: **stdio** (`npm start`) | Transport: **Streamable HTTP** at `POST /api/mcp` |
| Cursor launches `node dist/index.js` | Cursor connects to `https://<project>.vercel.app/api/mcp` |
| OAuth: Desktop app + loopback (`npm run auth`) | Same local auth once; paste secrets into Vercel env (Path A) |
| Secrets on disk under `~/.config/…` | Secrets as Vercel **Environment Variables** (no durable filesystem) |

This repo now supports **both**:

- Local stdio — unchanged for day-to-day Cursor use
- HTTP — `api/mcp.ts` (Vercel) and `npm run start:http` (local smoke test)

---

## 2. Target architecture

```text
┌─────────────────────┐   HTTPS + Bearer    ┌──────────────────────────────┐
│  Cursor / MCP client │ ─────────────────► │  Vercel Function             │
│  url + Authorization │    POST /api/mcp   │  Streamable HTTP MCP         │
└─────────────────────┘                     │  send_email                  │
                                            │  append_to_google_doc        │
                                            └──────────────┬───────────────┘
                                                           │ Google APIs
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │  Gmail + Docs (your account) │
                                            └──────────────────────────────┘
```

**Chosen hosted shape (personal use):**

1. Vercel Node.js Function at `/api/mcp` (Web-standard `GET`/`POST`/`DELETE` handlers).
2. Health check at `/api/health` (no auth).
3. **Bearer token** (`MCP_AUTH_TOKEN`) required on every `/api/mcp` request.
4. Google credentials loaded from env JSON (Path A) — not from a browser loopback on Vercel.
5. `maxDuration` 60s for Gmail/Docs latency.

---

## 3. Google auth on Vercel (Path A)

Vercel Functions are ephemeral. Do **not** expect `token.json` on disk across invocations.

### Recommended flow

1. Keep a **Desktop** OAuth client in Google Cloud (already used locally).
2. On your laptop: run `npm run auth` → writes `token.json`.
3. In Vercel Project → Settings → Environment Variables, set:

| Variable | Value |
|---|---|
| `MCP_AUTH_TOKEN` | Long random secret (Cursor sends this as `Authorization: Bearer …`) |
| `REQUIRE_MCP_AUTH` | `true` |
| `GOOGLE_OAUTH_CLIENT_JSON` | Full contents of `client_secret.json` / `credentials.json` |
| *or* `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` | Same client, as separate vars |
| `GOOGLE_OAUTH_TOKEN_JSON` | Full contents of `token.json` |

4. Redeploy after changing env vars.

Access tokens refresh in-memory per invocation using the refresh token inside `GOOGLE_OAUTH_TOKEN_JSON`. If Google returns `invalid_grant`, re-run local `npm run auth` and update the env var.

### Not in v1 hosted

- Web OAuth redirect UI on Vercel
- Multi-user Google accounts behind one URL
- MCP OAuth 2.1 authorization server (Claude/ChatGPT-style client registration)

---

## 4. What was implemented in code

| Piece | Location |
|---|---|
| Env + file config | `src/utils/config.ts` |
| Env-aware Google auth | `src/auth/google-auth.ts` |
| Bearer gate | `src/http/bearer-auth.ts` |
| Streamable HTTP app | `src/http/mcp-app.ts` (`createMcpHandler`) |
| Local HTTP smoke server | `src/http/local-server.ts` → `npm run start:http` |
| Vercel MCP route | `api/mcp.ts` |
| Vercel health route | `api/health.ts` |
| Function limits | `vercel.json` |
| Env template | `.env.example` |

Stdio entry (`src/index.ts`) is unchanged.

---

## 5. Deploy steps (ops)

### 5.1 Prerequisites

1. Vercel account + [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`) optional but handy.
2. GitHub/Git repo connected to Vercel, or deploy from CLI.
3. Google Cloud project with Gmail API + Docs API enabled.
4. Locally generated `token.json` with both scopes approved.
5. Strong random `MCP_AUTH_TOKEN` (32+ bytes).

### 5.2 Create the Vercel project

1. Import this repository in the Vercel dashboard (or `vercel` / `vercel --prod` from the project root).
2. Framework preset: **Other** (plain Node + `/api` Functions). Vercel detects `api/*.ts`.
3. Build settings:
   - **Install:** `npm install` (default)
   - **Build Command:** leave empty **or** `npm run build` (Functions compile `api/` + imports from `src/` themselves; `dist/` is mainly for local stdio)
   - **Output Directory:** leave empty
4. Set Node version ≥ 20 in Project Settings if prompted.

### 5.3 Configure environment variables

Add for **Production** (and Preview if you will test previews):

- `MCP_AUTH_TOKEN`
- `REQUIRE_MCP_AUTH=true`
- `GOOGLE_OAUTH_CLIENT_JSON` *(or ID + SECRET)*
- `GOOGLE_OAUTH_TOKEN_JSON`

Never commit these. Prefer Vercel’s encrypted env UI over putting secrets in `vercel.json`.

### 5.4 Deploy and verify

1. Deploy production.
2. `GET https://<project>.vercel.app/api/health` → `{ "ok": true, ... }`.
3. `POST https://<project>.vercel.app/api/mcp` without `Authorization` → `401`.
4. Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

   ```bash
   npx @modelcontextprotocol/inspector@latest
   ```

   - Transport: **Streamable HTTP**
   - URL: `https://<project>.vercel.app/api/mcp`
   - Header: `Authorization: Bearer <MCP_AUTH_TOKEN>`

5. List tools; call `send_email` with `confirm_send: false` first.

### 5.5 Connect Cursor

Project or user `mcp.json`:

```json
{
  "mcpServers": {
    "google-workspace-remote": {
      "url": "https://YOUR_PROJECT.vercel.app/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:GOOGLE_WORKSPACE_MCP_TOKEN}"
      }
    }
  }
}
```

Export locally:

```bash
export GOOGLE_WORKSPACE_MCP_TOKEN="same-as-MCP_AUTH_TOKEN-on-vercel"
```

Reload MCP servers in Cursor. Keep the **local stdio** server if you do not need remote access — smaller blast radius.

---

## 6. Local HTTP smoke test (before deploy)

```bash
export MCP_AUTH_TOKEN="dev-secret"
export GOOGLE_OAUTH_CLIENT_PATH="$HOME/.config/google-workspace-mcp/client_secret.json"
export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/google-workspace-mcp/token.json"
npm run start:http
```

Then point Inspector at `http://127.0.0.1:3000/api/mcp` with the same bearer token.

Optional: `vercel dev` loads Vercel env and serves `/api/mcp` the same way production does.

---

## 7. Security (non-negotiable)

Hosting this publicly without a gate ≈ publishing “send email as me” and “edit my Docs.”

### Must-have

- [x] Bearer auth on `/api/mcp` (`MCP_AUTH_TOKEN`)
- [ ] Secrets only in Vercel env — not in git, chat, or screenshots
- [x] `confirm_send` still enforced server-side
- [x] Minimal Google scopes (`gmail.send` + `documents`)
- [x] No logging of tokens / email bodies

### If something leaks

1. Rotate `MCP_AUTH_TOKEN` in Vercel + Cursor env; redeploy.
2. Google Account → revoke the app’s access.
3. Re-run `npm run auth`; update `GOOGLE_OAUTH_TOKEN_JSON`.
4. Rotate OAuth client secret in Google Cloud if the client JSON leaked; update Vercel env.

### Workspace hygiene

- Do not keep `credentials.json` in the project tree for agent access; prefer `~/.config/google-workspace-mcp/`.
- `.gitignore` already ignores `credentials*.json` / `token*.json`.

---

## 8. Vercel platform notes

| Topic | Implication |
|---|---|
| Ephemeral filesystem | Use env JSON for tokens; no Volume equivalent like Railway |
| Cold starts | First call after idle may be slower |
| `maxDuration` | Set to 60s for `/api/mcp` (see `vercel.json`) |
| Fluid compute | Good fit for bursty MCP traffic |
| Preview URLs | Protect with Deployment Protection **and** bearer token; do not put real Google tokens on shared previews unless intentional |
| Bundle size | `googleapis` is large; Node runtime is required (not Edge) |

---

## 9. Acceptance criteria

Vercel deployment is done when:

1. `/api/health` returns 200.
2. `/api/mcp` rejects unauthenticated callers.
3. Authenticated Cursor/Inspector lists `send_email` and `append_to_google_doc`.
4. Email preview never sends; confirmed send returns a Gmail message id.
5. Doc append is append-only and returns a Docs link.
6. Redeploy still works with the same env vars (no disk token dependency).
7. No client secrets or refresh tokens exist in git history from this work.

---

## 10. Effort / status

| Work | Status |
|---|---|
| HTTP MCP + bearer auth | Done in repo |
| Env-based Google secrets | Done in repo |
| Vercel `api/` routes + `vercel.json` | Done in repo |
| Local `npm run start:http` | Done in repo |
| Deploy + set Vercel env + Cursor remote config | **You (ops)** |
| Web OAuth on Vercel / multi-user | Deferred |

---

## 11. Quick command cheat sheet

```bash
# Local auth (once / when refresh fails)
export GOOGLE_OAUTH_CLIENT_PATH="$HOME/.config/google-workspace-mcp/client_secret.json"
export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/google-workspace-mcp/token.json"
npm run auth

# Local HTTP smoke
export MCP_AUTH_TOKEN="dev-secret"
npm run start:http

# Deploy
vercel --prod
```

After deploy, set env vars in the Vercel dashboard (or `vercel env add`), then redeploy so Functions pick them up.
