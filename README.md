# Google Workspace MCP Server

Local [Model Context Protocol](https://modelcontextprotocol.io) server for Cursor. It exposes two tools so the agent can act on **your** Google account:

1. **`send_email`** — send plain-text email via Gmail (with an explicit confirmation gate)
2. **`append_to_google_doc`** — append plain text to an existing Google Doc (append-only)

This is a **single-user, local development tool**. It is not intended for public distribution, multi-account team use, or remote hosting.

## Requirements

- Node.js 20+ (Node 22 recommended)
- A Google Cloud project with Gmail API and Google Docs API enabled
- Cursor with MCP support

## Quick start

```bash
npm install
npm run build
```

### 1. Google Cloud setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Gmail API** and **Google Docs API**.
3. Configure the OAuth consent screen. If the app is in **Testing**, add your Google account as a test user.
4. Create credentials → **OAuth client ID** → Application type **Desktop app**.
5. Download the client JSON and store it **outside** this repository, for example:

```bash
mkdir -p ~/.config/google-workspace-mcp
mv ~/Downloads/client_secret_*.json ~/.config/google-workspace-mcp/client_secret.json
chmod 600 ~/.config/google-workspace-mcp/client_secret.json
```

OAuth consent-screen publishing and verification requirements depend on how an app is distributed. This project is for **personal/local use**; keep it in testing mode with your account as a test user unless you intentionally publish it.

### 2. Environment paths

```bash
export GOOGLE_OAUTH_CLIENT_PATH="$HOME/.config/google-workspace-mcp/client_secret.json"
export GOOGLE_OAUTH_TOKEN_PATH="$HOME/.config/google-workspace-mcp/token.json"
```

### 3. One-time authorization

```bash
npm run auth
```

This opens a browser, requests only:

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/documents`

and saves tokens to `GOOGLE_OAUTH_TOKEN_PATH` (file mode `600` when the OS allows).

### 4. Build

```bash
npm run build
```

### 5. Cursor MCP config

An example is in [`.cursor/mcp.json`](.cursor/mcp.json):

```json
{
  "mcpServers": {
    "google-workspace": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/stdio.js"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_PATH": "${userHome}/.config/google-workspace-mcp/client_secret.json",
        "GOOGLE_OAUTH_TOKEN_PATH": "${userHome}/.config/google-workspace-mcp/token.json"
      }
    }
  }
}
```

If your Cursor version uses a slightly different MCP config shape, follow the current [Cursor MCP documentation](https://docs.cursor.com/context/mcp).

Restart or refresh MCP servers in Cursor and confirm both tools appear: `send_email`, `append_to_google_doc`.

## Tools

### `send_email`

| Field | Required | Description |
|-------|----------|-------------|
| `to` | yes | One or more recipient emails |
| `subject` | yes | Non-empty subject |
| `body` | yes | Plain-text body (line breaks preserved) |
| `cc` / `bcc` | no | Optional recipient lists |
| `confirm_send` | yes | Must be `true` to send; `false` returns a preview only |

**Safety:** The assistant should show recipients, subject, and body and get your approval before calling with `confirm_send: true`. Preview calls never hit Gmail’s send endpoint. Ambiguous network timeouts are **not** auto-retried — check Sent mail before retrying.

### `append_to_google_doc`

| Field | Required | Description |
|-------|----------|-------------|
| `document_id_or_url` | yes | Document ID or Docs URL |
| `content` | yes | Text to append |

**Safety:** Append only via `insertText` + `endOfSegmentLocation`. Never overwrites, deletes, creates documents, or changes sharing.

## Project layout

```text
src/
  stdio.ts              # local Cursor stdio entry (not a Vercel HTTP entry)
  constants.ts          # name/version (safe for /api/health)
  server.ts             # MCP factory + tool registration
  auth/                 # OAuth client + npm run auth
  http/                 # Streamable HTTP + bearer gate (Vercel / local)
  tools/                # send_email, append_to_google_doc
  services/             # Gmail MIME/send, Docs append
  utils/                # config, validation, errors
api/                    # Vercel Functions (/api/mcp, /api/health)
tests/                  # mocked unit tests
docs/                   # problem statement, architecture, deploy plan
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled stdio server |
| `npm run start:http` | Local Streamable HTTP server (`/api/mcp`) for smoke tests |
| `npm run auth` | First-run (or re-run) Google OAuth |
| `npm test` | Unit tests with mocked Google APIs |
| `npm run typecheck` | `tsc --noEmit` |

## Remote deploy (Vercel)

The same tools can be hosted as a Vercel Function at `/api/mcp` (Streamable HTTP + bearer auth). Authorize once locally with `npm run auth`, then set `MCP_AUTH_TOKEN`, `GOOGLE_OAUTH_CLIENT_JSON` (or client id/secret), and `GOOGLE_OAUTH_TOKEN_JSON` in the Vercel project env.

Full steps: [`docs/deployment-plan.md`](docs/deployment-plan.md).

## Testing

```bash
npm test
```

Tests mock Gmail/Docs clients. They do **not** send real email or modify real documents.

## Security

- Never commit `client_secret*.json` or `token*.json` (see `.gitignore`).
- Prefer paths under `~/.config/google-workspace-mcp/`.
- The server logs to **stderr** only; do not add `console.log` diagnostics (stdout is the MCP channel).
- Tokens, client secrets, and email bodies are not written to logs.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Tools missing in Cursor | Build (`npm run build`), check `mcp.json` paths, refresh MCP servers |
| Auth / 401 errors | Re-run `npm run auth`; confirm test user on consent screen |
| Insufficient scopes | Re-authorize and approve both Gmail send and Docs |
| Document not found / 403 | Confirm the Doc ID and that the authorized account can edit it |
| Email “uncertain” after timeout | Check Gmail **Sent**; do not retry blindly |
| MCP connection broken | Ensure nothing writes to stdout except the MCP SDK |

## Out of scope (v1)

Reading/searching Gmail, drafts, replies, attachments, HTML mail, creating Docs, Drive search, rich formatting, multi-account, remote hosting, web UI.

## References

- [`docs/problemstatement.md`](docs/problemstatement.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/implementation-plan.md`](docs/implementation-plan.md)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/)
- [Gmail API: send messages](https://developers.google.com/gmail/api/guides/sending)
- [Google Docs API: batchUpdate](https://developers.google.com/docs/api/reference/rest/v1/documents/batchUpdate)
