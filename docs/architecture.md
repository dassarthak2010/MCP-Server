# Architecture: Google Workspace MCP Server for Cursor

This document describes the system architecture for the local Google Workspace MCP server defined in [`problemstatement.md`](./problemstatement.md). It is the technical blueprint for implementing the two MVP tools—`send_email` and `append_to_google_doc`—with OAuth 2.0, stdio transport, and Cursor integration.

---

## 1. Purpose and context

### 1.1 What this system is

A **single-user, local MCP (Model Context Protocol) server** that Cursor launches as a child process. It exposes two Google Workspace actions as MCP tools so the Cursor Agent can invoke them from natural language without the user writing API calls.

| Capability | Mechanism |
|---|---|
| Send plain-text email | Gmail API `users.messages.send` |
| Append text to an existing Doc | Google Docs API `documents.batchUpdate` (`insertText` + `endOfSegmentLocation`) |

### 1.2 What this system is not

- Not a hosted SaaS, multi-tenant, or team product
- Not a Gmail/Drive search, draft, reply, or attachment client
- Not a document creator or permissions manager
- Not an auto-sender that acts on inferred intent without explicit confirmation

### 1.3 Design priorities (MVP)

1. **Reliability** — correct API usage, no duplicate sends on ambiguous timeouts  
2. **Clear permissions** — minimal OAuth scopes; explicit `confirm_send` gate  
3. **Safe credentials** — no secrets in repo; tokens outside the project tree  
4. **Simple setup** — documented Google Cloud + `npm run auth` + Cursor `mcp.json`

---

## 2. System context

```text
┌──────────────────────────────────────────────────────────────────┐
│                         User (Cursor IDE)                        │
│  Natural language → Agent selects MCP tool → structured args     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ stdio (JSON-RPC / MCP)
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│              Google Workspace MCP Server (Node.js)               │
│  Tool registry · Zod validation · Auth · Gmail/Docs services     │
└───────────────┬──────────────────────────────┬───────────────────┘
                │ HTTPS (OAuth + APIs)         │
                ▼                              ▼
     ┌─────────────────────┐        ┌─────────────────────┐
     │  Google OAuth 2.0   │        │  Google Workspace   │
     │  (desktop / loopback│        │  Gmail API          │
     │   installed app)    │        │  Docs API           │
     └─────────────────────┘        └─────────────────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Local credential    │
     │ store (outside repo)│
     │ client_secret.json  │
     │ token.json          │
     └─────────────────────┘
```

**Trust boundary:** The MCP process runs with the user's OS identity and Google account consent. Cursor can invoke tools; the server must still enforce validation, the send-confirmation gate, and append-only Docs behavior.

---

## 3. High-level architecture

The server is a layered local process:

```text
┌─────────────────────────────────────────────────────────────┐
│ Layer 0 — Process & transport                               │
│   src/index.ts · MCP SDK · stdio · stderr diagnostics only  │
└─────────────────────────────┬───────────────────────────────┘
                              │ tool invoke
┌─────────────────────────────▼───────────────────────────────┐
│ Layer 1 — MCP tools (agent-facing contract)                 │
│   send_email · append_to_google_doc                         │
│   Zod schemas · tool descriptions · confirm_send gate       │
└─────────────────────────────┬───────────────────────────────┘
                              │ validated domain calls
┌─────────────────────────────▼───────────────────────────────┐
│ Layer 2 — Domain services                                   │
│   GmailService (MIME + send) · DocsService (parse + append) │
└─────────────────────────────┬───────────────────────────────┘
                              │ authenticated clients
┌─────────────────────────────▼───────────────────────────────┐
│ Layer 3 — Auth & Google clients                             │
│   OAuth client · token load/refresh · googleapis wrappers   │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│ Layer 4 — Cross-cutting utils                               │
│   email/doc validation · safe error mapping · config paths  │
└─────────────────────────────────────────────────────────────┘
```

**Separation rule:** Authentication, Google API I/O, and MCP tool registration stay in distinct modules so tools can be tested with mocked services and services can be tested without the MCP transport.

---

## 4. Component design

### 4.1 Suggested package layout

```text
google-workspace-mcp/
├── src/
│   ├── index.ts                 # MCP server entry; stdio transport; tool registration
│   ├── auth/
│   │   ├── google-auth.ts       # Load client + token; refresh; build OAuth2 client
│   │   └── authorize.ts         # CLI: browser/loopback first-run auth
│   ├── tools/
│   │   ├── send-email.ts        # send_email handler + schema + description
│   │   └── append-doc.ts        # append_to_google_doc handler + schema
│   ├── services/
│   │   ├── gmail.ts             # MIME builder; users.messages.send
│   │   └── docs.ts              # ID/URL parse; get (as needed); batchUpdate insert
│   └── utils/
│       ├── validation.ts        # Email + document ID/URL validators
│       ├── config.ts            # Env path resolution; missing-config errors
│       └── errors.ts            # Map Google/HTTP failures → safe MCP errors
├── tests/
│   ├── send-email.test.ts
│   ├── append-doc.test.ts
│   ├── validation.test.ts
│   └── server.test.ts           # Tool registration / stdout hygiene (as feasible)
├── .cursor/
│   └── mcp.json                 # Example Cursor stdio config
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

Exact file names may vary slightly; logical boundaries must not.

### 4.2 Component responsibilities

| Component | Responsibility | Must not |
|---|---|---|
| `index.ts` | Create MCP server, register tools, connect stdio, exit cleanly on fatal config | Log to stdout; start an HTTP server |
| `authorize.ts` | One-time OAuth consent; persist tokens | Request scopes beyond Gmail send + Docs |
| `google-auth.ts` | Provide authenticated `googleapis` clients; refresh tokens | Print tokens or client secrets |
| `send-email` tool | Validate inputs; preview vs send; call GmailService | Invent defaults; retry ambiguous timeouts |
| `append-doc` tool | Validate ID/URL + content; call DocsService | Create docs; overwrite; change permissions |
| `gmail.ts` | Build RFC-compliant MIME; Base64URL-encode; call send | HTML/attachments in MVP |
| `docs.ts` | Resolve ID; optional get for newline policy; `insertText` at end of body | Use fixed character indices; delete content |
| `validation.ts` | Syntactic email checks; Docs URL/ID extraction | Infer doc from title |
| `errors.ts` | Actionable, non-secret error strings for the model | Leak stack traces or tokens |

---

## 5. Runtime and transport

### 5.1 Runtime stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Current Node.js LTS compatible with the MCP SDK |
| MCP SDK | Stable v2: `@modelcontextprotocol/sdk` / `@modelcontextprotocol/server` per current docs — **do not mix v1 and v2 APIs** |
| Transport | **stdio only** for Cursor child-process integration |
| Google client | Official `googleapis` (or equivalent maintained client) |
| Input validation | Zod (or equivalent) for tool arguments |
| Dependency hygiene | Pin versions; commit lockfile |

### 5.2 Stdio contract

| Stream | Allowed content |
|---|---|
| **stdout** | MCP protocol messages only |
| **stderr** | Diagnostic logs, startup warnings, auth status (never secrets or email bodies) |

`console.log` must not be used for ordinary diagnostics; it writes to stdout and corrupts the MCP session.

### 5.3 Process lifecycle

```text
Cursor starts MCP process
        │
        ▼
Load env: GOOGLE_OAUTH_CLIENT_PATH, GOOGLE_OAUTH_TOKEN_PATH
        │
        ├─ Missing/unreadable → register tools that fail fast with clear errors
        │                       (or fail startup with actionable message—prefer
        │                        tool-time errors so Cursor still discovers tools)
        │
        ▼
Connect MCP over stdio; advertise send_email + append_to_google_doc
        │
        ▼
On tool call → validate → ensure auth → call Google API → return result/error
        │
        ▼
Process stays alive until Cursor closes the transport
```

**Startup goal:** Fast start; missing auth must produce clear MCP tool errors, not silent hangs.

---

## 6. Authentication architecture

### 6.1 OAuth model

Use **OAuth 2.0 for a desktop / installed application** accessing the user's own Google account.

- **Not used for MVP personal flow:** service-account keys  
- **Consent:** first-run CLI (`npm run auth` or equivalent)  
- **Callback:** local loopback (or other supported installed-app flow)  
- **Persistence:** refresh + access token data on disk outside the repo (OS secure store preferred when practical; MVP may use a restricted token file)

### 6.2 Minimum scopes

| Feature | Scope |
|---|---|
| Send email | `https://www.googleapis.com/auth/gmail.send` |
| Edit Docs | `https://www.googleapis.com/auth/documents` |

Do not request broad Gmail or Drive scopes in v1.

### 6.3 Auth sequence (first run)

```text
User runs: npm run auth
        │
        ▼
Read OAuth desktop client JSON from GOOGLE_OAUTH_CLIENT_PATH
        │
        ▼
Open Google consent URL in browser (or print URL)
        │
        ▼
User grants gmail.send + documents (test user if app in testing)
        │
        ▼
Local loopback receives authorization code
        │
        ▼
Exchange code → tokens → write GOOGLE_OAUTH_TOKEN_PATH
        │
        ▼
Subsequent MCP runs: load token → refresh as needed → call APIs
```

### 6.4 Token refresh behavior

| Situation | Behavior |
|---|---|
| Access token expired | Refresh using stored refresh token; persist new tokens if rotated |
| Refresh fails / revoked | Return actionable “re-run authorization” error; do not retry endlessly |
| Required scope missing | Distinct error: re-authorize with required scopes |
| Client JSON missing | Setup error naming the expected path / env var |

### 6.5 Google Cloud prerequisites (documented in README)

1. Create/select GCP project  
2. Enable **Gmail API** and **Google Docs API**  
3. Configure OAuth consent screen; add test user if in testing  
4. Create OAuth client ID — **Desktop app**  
5. Download client JSON to the path expected by config  
6. Run auth once; build; configure Cursor; refresh MCP servers  

---

## 7. MCP tool contracts

### 7.1 Tool inventory (MVP)

Exactly **two** tools:

1. `send_email`  
2. `append_to_google_doc`

Tool names and descriptions must be written for model comprehension: when to call, required fields, and safety rules (especially confirmation before send).

---

### 7.2 `send_email`

**Purpose:** Send plain-text email from the authorized Gmail account.

#### Input schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | `string[]` (emails) | Yes | ≥1 syntactically valid address |
| `subject` | `string` | Yes | Reject empty / whitespace-only |
| `body` | `string` | Yes | Plain text; preserve line breaks |
| `cc` | `string[]` | No | Validate when present |
| `bcc` | `string[]` | No | Validate when present |
| `confirm_send` | `boolean` | Yes | Must be `true` to send |

#### Control flow

```text
                    ┌─────────────────────┐
                    │  Validate inputs    │
                    └──────────┬──────────┘
                               │
              ┌────────────────▼────────────────┐
              │ confirm_send === false ?        │
              └────────────────┬────────────────┘
                    yes        │         no
                     │         │
                     ▼         ▼
          Return preview   Build MIME → Base64URL
          (no Gmail call)  → users.messages.send(userId: "me")
                                   │
                     ┌─────────────┴─────────────┐
                     │ success                   │ ambiguous timeout
                     ▼                           ▼
              Confirm + messageId      Report uncertainty;
                                       advise check Sent;
                                       DO NOT auto-retry
```

#### Safety rules (enforced by design)

- Tool description: call only when the user explicitly asked to send email.  
- Model should present recipients, subject, and body and obtain confirmation before `confirm_send: true`.  
- Preview path (`confirm_send: false`) **never** calls Gmail send.  
- Server invents **no** default recipient, subject, or body.  
- MVP: plain text only (no HTML, no attachments).

#### Success response (conceptual)

- Concise confirmation  
- Gmail message ID  
- Success claimed only after a successful Gmail response  

---

### 7.3 `append_to_google_doc`

**Purpose:** Append plain text to the end of an existing Google Doc.

#### Input schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `document_id_or_url` | `string` | Yes | Raw ID or `https://docs.google.com/document/d/{id}/...` |
| `content` | `string` | Yes | Preserve line breaks and Unicode; reject empty/whitespace-only |

#### Control flow

```text
Parse & validate document ID from ID or URL
        │
        ▼
Reject unrelated URLs / empty IDs / empty content
        │
        ▼
(Optional) documents.get — decide if a separating newline is needed
        │  empty body → avoid unnecessary blank paragraphs
        │  non-empty  → ensure append does not run into prior text
        ▼
documents.batchUpdate:
  insertText + endOfSegmentLocation (document body)
        │
        ▼
Add trailing newline on inserted block when needed
        │
        ▼
Return success + document ID + document link
  (or API error without claiming append succeeded)
```

#### Safety rules

- **Append only** — never clear, overwrite, truncate, or delete  
- Do not create a document if missing  
- Do not change sharing/permissions  
- Do not infer document from title — ID or URL required  
- Prefer `endOfSegmentLocation` over a fixed index (docs can change between read and write)

---

## 8. Domain service design

### 8.1 Gmail service

**Responsibilities**

1. Normalize addresses (trim); keep body formatting meaningful  
2. Construct standards-compliant MIME (`To`/`Cc`/`Bcc`/`Subject`/`Content-Type: text/plain`)  
3. Encode raw message as **Base64 URL-safe**  
4. Call `gmail.users.messages.send({ userId: "me", requestBody: { raw } })`  
5. Map API errors via `errors.ts`  
6. On ambiguous network timeout: surface uncertainty; **zero automatic retries**

**MIME considerations**

- Encode non-ASCII subject/body per common MIME practices (e.g. UTF-8)  
- Preserve `\n` in body  
- Include `Cc`/`Bcc` headers only when provided  

### 8.2 Docs service

**Responsibilities**

1. Extract document ID via shared validator  
2. Optionally `documents.get` to inspect body emptiness for newline policy  
3. Build `batchUpdate` with a single `insertText` request targeting end of body segment  
4. Apply separating / trailing newline rules without inventing extra blank paragraphs on empty docs  
5. Return document URL: `https://docs.google.com/document/d/{id}/edit`

**Invariant:** Every write path is insert-at-end; no `deleteContentRange` / replace requests in MVP.

### 8.3 Validation utilities

| Input | Rules |
|---|---|
| Email | At least one valid `to`; validate `cc`/`bcc` when present; trim addresses |
| Subject | Non-empty after trim |
| Body (email) | Non-empty after considering whitespace-only rejection; preserve internal newlines |
| Doc URL | Match Docs document path pattern; extract `{documentId}` |
| Doc ID | Non-empty; reject Drive folder URLs and unrelated hosts |
| Content (doc) | Reject empty / whitespace-only |

---

## 9. Configuration and secrets

### 9.1 Environment variables

| Variable | Meaning |
|---|---|
| `GOOGLE_OAUTH_CLIENT_PATH` | Path to downloaded OAuth desktop client JSON |
| `GOOGLE_OAUTH_TOKEN_PATH` | Path to persist authorized user token data |

### 9.2 Security requirements

- Never hardcode client secrets, tokens, or personal emails  
- Never commit client JSON or token files  
- `.gitignore` must cover credential/token paths and common filenames  
- Prefer storing tokens **outside** the repository (`~/.config/google-workspace-mcp/` or similar)  
- Restrict file permissions on token files where the OS allows  
- Never log tokens, client secrets, email bodies, or other sensitive payloads  

### 9.3 Example Cursor configuration

```json
{
  "mcpServers": {
    "google-workspace": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_PATH": "${userHome}/.config/google-workspace-mcp/client_secret.json",
        "GOOGLE_OAUTH_TOKEN_PATH": "${userHome}/.config/google-workspace-mcp/token.json"
      }
    }
  }
}
```

If a given Cursor version uses a different MCP config shape, follow current Cursor docs and update the example accordingly.

### 9.4 Operator workflow

1. Install dependencies  
2. Configure GCP; save client JSON outside the repo  
3. Set the two path env vars  
4. Run one-time authorization  
5. Build TypeScript → `dist/`  
6. Add/adjust `.cursor/mcp.json`  
7. Restart/refresh MCP in Cursor; verify both tools appear  

---

## 10. Error handling architecture

Errors returned to the model must be **concise, actionable, and non-secret**.

### 10.1 Required error cases

| Case | Guidance to model/user |
|---|---|
| OAuth client missing/unreadable | Point to `GOOGLE_OAUTH_CLIENT_PATH` / setup steps |
| Not authorized / expired / refresh failed | Instruct re-run of auth command |
| Required scope not granted | Re-authorize with listed scopes |
| Invalid recipient email | Name the bad address(es) |
| Missing to / subject / body | Name the missing field |
| `confirm_send: false` | Preview returned; nothing sent (not a failure) |
| Invalid Docs URL/ID | Explain accepted formats |
| Doc not found / inaccessible / not editable | Check ID and sharing with the authorized account |
| Rate limit / quota / transient Google error | Retry later; preserve safe status details |
| Ambiguous Gmail send timeout | Do not claim send; advise check Sent; no auto-retry |

### 10.2 Error mapping policy

```text
googleapis / network error
        │
        ▼
Classify (auth | validation | not-found | quota | timeout | unknown)
        │
        ▼
Strip tokens, secrets, stack traces
        │
        ▼
Return MCP tool error / structured content with safe HTTP status hints
```

---

## 11. Data flow diagrams

### 11.1 Email send (confirmed)

```text
User → Cursor Agent
  "Send email to alex@… subject … body …"
        │
        ▼
Agent calls send_email(confirm_send: false)  →  preview
        │
User confirms
        │
        ▼
Agent calls send_email(confirm_send: true)
        │
        ▼
Zod validate → Auth client → MIME → Gmail send
        │
        ▼
Tool result: confirmation + messageId
```

### 11.2 Doc append

```text
User → Cursor Agent
  "Append these notes to https://docs.google.com/document/d/ABC/edit"
        │
        ▼
Agent calls append_to_google_doc({ document_id_or_url, content })
        │
        ▼
Parse ID → validate content → (optional get) → batchUpdate insertText
        │
        ▼
Tool result: success + document ID + link
```

---

## 12. Testing architecture

### 12.1 Principles

- Unit tests with **mocked** Google API clients  
- Tests must **not** send real email or modify real documents  
- Prefer testing services and validators in isolation; thin tool wrappers can be tested with mocked services  

### 12.2 Minimum coverage matrix

**`send_email` / Gmail**

- Valid to/subject/body → valid Gmail API request shape  
- `cc` / `bcc` headers when supplied  
- Body newlines and non-ASCII preserved  
- Invalid/missing recipients rejected  
- `confirm_send: false` → preview + **zero** send calls  
- `confirm_send: true` → **exactly one** send  
- Ambiguous timeout → no automatic retry  

**`append_to_google_doc` / Docs**

- Raw document ID accepted  
- Valid Docs URL parsed  
- Unrelated URL / empty ID rejected  
- Empty content rejected  
- Request uses `insertText` + `endOfSegmentLocation`  
- No delete/replace operations  
- Newline behavior for empty vs non-empty docs  
- API errors do not produce false success  

**MCP server**

- Starts over stdio and registers exactly the two MVP tools  
- Schemas reject invalid arguments  
- No diagnostic output on stdout  

---

## 13. Implementation sequence

Aligned with the problem statement’s build order:

| Phase | Deliverable |
|---|---|
| 1 | Scaffold TypeScript project; MCP SDK + stdio; empty tool stubs |
| 2 | OAuth client loading, token persistence, `npm run auth`, auth health check |
| 3 | MIME builder + `send_email` + unit tests |
| 4 | Document ID parsing + `append_to_google_doc` + unit tests |
| 5 | Finalize tool names, descriptions, Zod schemas; register both tools |
| 6 | Cursor `mcp.json` example, README, error mapping, remaining tests |
| 7 | Full build + test suite green; acceptance checklist |

---

## 14. Acceptance criteria (architecture view)

The architecture is successfully realized when:

- [ ] Project builds and starts locally without TypeScript errors  
- [ ] First-run OAuth authorizes a Google account and persists credentials for local personal use  
- [ ] Cursor launches the server via `.cursor/mcp.json` and discovers both tools  
- [ ] `send_email` sends only after explicit confirmation (`confirm_send: true`)  
- [ ] Preview invocations never send  
- [ ] `append_to_google_doc` appends without replacing existing content  
- [ ] Both tools return clear successes and actionable errors  
- [ ] Unit tests cover critical paths with mocked APIs  
- [ ] README covers setup, OAuth, Cursor, testing, troubleshooting  
- [ ] No secrets or token files are committed  

---

## 15. Explicit non-goals (v1)

Deferred unless a later version revisits scope:

- Read/search/label/delete Gmail; drafts; replies; forwards; attachments; HTML mail  
- Create Docs; Drive search; permission changes; rich formatting; templates  
- Multi-account, remote hosting, web UI, team deployment  
- Automatic send without explicit user approval  

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Duplicate emails on flaky network | No auto-retry after ambiguous send timeout; advise checking Sent |
| Accidental send by the model | Mandatory `confirm_send`; preview path; tool description safety copy |
| Over-scoped OAuth | Ship only `gmail.send` + `documents` |
| Stdio corruption | All logs → stderr; ban `console.log` for diagnostics |
| Token leakage | Outside-repo storage; gitignore; never log secrets |
| Stale doc indices | Always append via `endOfSegmentLocation` |
| Cursor config drift | Document “follow current Cursor MCP docs”; keep example minimal |

---

## 17. Official references

Use current official docs during implementation (APIs and SDKs change):

- Cursor MCP documentation  
- MCP TypeScript SDK v2 documentation  
- Gmail API: create/send messages; `users.messages.send`  
- Google Docs API: `documents.batchUpdate`; `InsertTextRequest`  
- Google Workspace: create access credentials; enable APIs  

---

## 18. Source of truth

[`problemstatement.md`](./problemstatement.md) remains the product and behavioral source of truth. This architecture translates that specification into component boundaries, data flows, and constraints. Where this document and the problem statement diverge, **prefer the problem statement**, and document any intentional implementation deviation in the README.
