# Implementation Plan: Google Workspace MCP Server

Phase-wise plan to build the project defined in [`problemstatement.md`](./problemstatement.md) and [`architecture.md`](./architecture.md). Execute phases in order. Do not start the next phase until the current phase’s exit criteria pass.

**Sources of truth:** problem statement (behavior) → architecture (structure) → this plan (execution order).

---

## Guiding rules (all phases)

- Ship a **working local MCP server**, not sample snippets.
- MVP tools only: `send_email`, `append_to_google_doc`.
- TypeScript + Node.js LTS + MCP SDK **v2** (do not mix v1/v2 APIs).
- Stdio transport only; **logs go to stderr**; never pollute stdout.
- No secrets in the repo; credential/token paths outside the project tree.
- Unit tests mock Google APIs — never send real mail or edit real docs in CI/tests.
- Prefer small, reviewable increments that leave the tree buildable after each phase.

---

## Phase overview

| Phase | Name | Outcome |
|------:|------|---------|
| 0 | Prerequisites & Google Cloud prep | Human setup ready before/alongside coding |
| 1 | Project scaffold & MCP stdio skeleton | Empty server builds, starts, speaks MCP |
| 2 | Config, OAuth, and token persistence | `npm run auth` works; authenticated clients available |
| 3 | Validation utils & safe errors | Shared validators + error mapping |
| 4 | Gmail MIME + `send_email` | Preview/send tool complete with tests |
| 5 | Docs append + `append_to_google_doc` | Append-only tool complete with tests |
| 6 | Tool registration polish, Cursor config, README | Discoverable in Cursor; documented |
| 7 | Hardening, full test suite, acceptance | Checklist green; MVP complete |

Phases 3–5 can partially overlap in file creation, but **Gmail (4) before Docs (5)** matches the problem statement; finish Phase 2 before either tool calls live Google APIs.

---

## Phase 0 — Prerequisites & Google Cloud prep

**Goal:** Operator can create OAuth credentials and store them safely. Coding can start in parallel, but auth (Phase 2) cannot be end-to-end verified without this.

### Tasks

1. Create or select a Google Cloud project.
2. Enable **Gmail API** and **Google Docs API**.
3. Configure OAuth consent screen; add the user’s account as a **test user** if the app is in testing.
4. Create an OAuth client ID with application type **Desktop app**.
5. Download the client JSON to a path **outside** the repo, e.g.  
   `~/.config/google-workspace-mcp/client_secret.json`.
6. Confirm README will later document publishing/verification caveats for personal/local use.

### Deliverables

- Client secret JSON on disk (not in git).
- Notes of exact paths for `GOOGLE_OAUTH_CLIENT_PATH` / `GOOGLE_OAUTH_TOKEN_PATH`.

### Exit criteria

- [ ] Both APIs enabled.
- [ ] Desktop OAuth client exists and JSON is readable from the chosen path.
- [ ] Path is outside the repository.

### Out of scope

- Requesting scopes beyond `gmail.send` and `documents`.
- Service accounts for the personal-account flow.

---

## Phase 1 — Project scaffold & MCP stdio skeleton

**Goal:** A TypeScript Node project that builds, starts over stdio with the MCP SDK, and is ready for tool registration.

### Tasks

1. Initialize `package.json` with name, scripts (`build`, `start`, `auth`, `test`), and engines for Node LTS.
2. Add TypeScript (`tsconfig.json` targeting modern Node), pin dependencies, commit lockfile when introduced.
3. Install current stable MCP TypeScript server SDK (**v2 APIs only**).
4. Create `src/index.ts`:
   - Construct MCP server.
   - Connect **stdio** transport.
   - Register zero or stub tools temporarily (prefer stubs with clear “not implemented” only if needed for smoke; ideally empty until Phase 4/5).
5. Ensure diagnostic logging uses **stderr** only.
6. Add `.gitignore`: `node_modules/`, `dist/`, env files, `*client_secret*`, `*token*.json`, local credential paths.
7. Create folder placeholders matching architecture:
   - `src/auth/`, `src/tools/`, `src/services/`, `src/utils/`, `tests/`
8. Verify `npm run build` emits `dist/index.js` (or equivalent entry).

### Files to create / touch

| Path | Purpose |
|------|---------|
| `package.json` | Scripts + deps |
| `tsconfig.json` | Compile settings |
| `src/index.ts` | MCP entry + stdio |
| `.gitignore` | Secrets + build artifacts |
| `package-lock.json` / equivalent | Locked versions |

### Exit criteria

- [ ] `npm install` and `npm run build` succeed with no TypeScript errors.
- [ ] Process starts and can be launched as a stdio MCP server.
- [ ] No `console.log` diagnostics on the hot path; stdout reserved for MCP.
- [ ] `.gitignore` excludes credential/token patterns.

### Tests this phase

- Optional smoke: process starts without crashing when run under the SDK test harness or a short script.
- Full tool-registration assertions wait until Phase 6/7.

---

## Phase 2 — Config, OAuth, and token persistence

**Goal:** First-run authorization and reusable authenticated Google clients for Gmail/Docs.

### Tasks

1. Implement `src/utils/config.ts` (or equivalent):
   - Read `GOOGLE_OAUTH_CLIENT_PATH` and `GOOGLE_OAUTH_TOKEN_PATH`.
   - Fail with actionable errors if missing/unreadable.
2. Implement `src/auth/google-auth.ts`:
   - Load desktop client credentials.
   - Load/store tokens at `GOOGLE_OAUTH_TOKEN_PATH`.
   - Refresh access tokens when required.
   - Export helpers that return authenticated `googleapis` OAuth2 clients / API handles.
3. Implement `src/auth/authorize.ts` + `npm run auth`:
   - Open browser (or print URL).
   - Request **only**:
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/documents`
   - Loopback / installed-app callback.
   - Persist tokens; set restrictive file permissions where supported.
4. Add an auth health check usable by tools (e.g. “token present and refreshable”).
5. Confirm tokens are never logged.

### Files

| Path | Purpose |
|------|---------|
| `src/utils/config.ts` | Env/path resolution |
| `src/auth/google-auth.ts` | Client + refresh |
| `src/auth/authorize.ts` | CLI first-run flow |
| `package.json` | `auth` script |

### Manual verification

1. Set env vars to Phase 0 paths.
2. Run `npm run auth`; complete consent as the test user.
3. Confirm token file written outside the repo.
4. Re-run a small script that loads auth and refreshes without re-prompting.

### Exit criteria

- [ ] `npm run auth` completes and persists tokens.
- [ ] Subsequent loads refresh without browser when refresh token is valid.
- [ ] Missing client/token produces clear setup errors.
- [ ] Scopes limited to the two required URIs.
- [ ] No secrets printed to stderr/stdout.

### Tests this phase

- Unit-test config path resolution and “missing file” errors (mock fs).
- Mock OAuth refresh success/failure paths if practical; avoid live Google in automated tests.

---

## Phase 3 — Validation utils & safe error mapping

**Goal:** Shared input validation and user-safe error translation before wiring tools.

### Tasks

1. Implement `src/utils/validation.ts`:
   - Email syntax checks for `to` / `cc` / `bcc`.
   - Reject empty/whitespace-only subject and email body (preserve meaningful body newlines).
   - Parse Google Docs URL → document ID; accept raw IDs.
   - Reject unrelated URLs, empty IDs, empty doc content.
2. Implement `src/utils/errors.ts`:
   - Map auth, validation, not-found, quota, timeout, and unknown Google errors.
   - Strip stack traces, tokens, and secrets.
   - Preserve safe HTTP status / reason phrases when useful.
3. Export typed error helpers tools/services can throw or return.

### Files

| Path | Purpose |
|------|---------|
| `src/utils/validation.ts` | Email + doc ID/URL rules |
| `src/utils/errors.ts` | Safe error mapping |
| `tests/validation.test.ts` | Validator coverage |

### Exit criteria

- [ ] Validation tests cover: valid/invalid emails; Docs ID; Docs URL; unrelated URL; empty content/subject/body.
- [ ] Error mapper never includes tokens or raw stacks in messages intended for the model.

### Tests (required)

- `tests/validation.test.ts` as specified in the problem statement minimum set for URL/email cases.

---

## Phase 4 — Gmail MIME builder & `send_email`

**Goal:** Fully working `send_email` tool with preview gate, MIME construction, and mocked tests.

### Tasks

1. Implement `src/services/gmail.ts`:
   - Build standards-compliant plain-text MIME (`To`, `Subject`, optional `Cc`/`Bcc`).
   - Preserve body line breaks and non-ASCII (UTF-8 MIME practices).
   - Base64 URL-safe encode raw message.
   - Call `users.messages.send` with `userId: "me"`.
   - **Do not auto-retry** after ambiguous network timeouts; return uncertainty guidance.
2. Implement `src/tools/send-email.ts`:
   - Zod (or equivalent) input schema matching the problem statement.
   - Tool description: only when user explicitly asked to send; present recipients/subject/body; confirm before `confirm_send: true`.
   - `confirm_send: false` → preview only; **zero** Gmail send calls.
   - `confirm_send: true` → exactly one send on success path.
   - No invented defaults for recipient/subject/body.
3. Wire tool into `src/index.ts` (can register alone until Phase 5).
4. Add `tests/send-email.test.ts` with mocked Gmail client.

### Behavior checklist

| Case | Expected |
|------|----------|
| Valid to/subject/body + `confirm_send: true` | One send; return message ID |
| `cc` / `bcc` supplied | Headers included |
| `confirm_send: false` | Preview; no API send |
| Invalid/missing fields | Rejected with clear error |
| Ambiguous timeout | No retry; advise check Sent |

### Exit criteria

- [ ] Preview never sends.
- [ ] Confirmed send constructs valid MIME and calls Gmail once (in tests via mock).
- [ ] Unit tests for Phase 4 cases pass.
- [ ] Auth/config failures surface as actionable tool errors.

### Manual smoke (optional, after Phase 2)

- Preview to yourself; confirm no message arrives.
- Confirmed send to yourself; verify message ID and inbox/Sent.

---

## Phase 5 — Docs service & `append_to_google_doc`

**Goal:** Append-only Google Docs tool using `batchUpdate` + `insertText` + `endOfSegmentLocation`.

### Tasks

1. Implement `src/services/docs.ts`:
   - Resolve document ID via validation utils.
   - Optionally `documents.get` to decide separating newline (empty vs non-empty body).
   - Append with `insertText` and `endOfSegmentLocation` targeting the document body.
   - Trailing newline policy for subsequent edits; no unnecessary blank paragraphs on empty docs.
   - **Never** delete, replace, truncate, or clear content; never create a new doc; never change permissions.
2. Implement `src/tools/append-doc.ts`:
   - Zod schema: `document_id_or_url`, `content`.
   - Tool description: require ID/URL; append-only semantics.
   - Success: document ID + link (`https://docs.google.com/document/d/{id}/edit`).
   - API failures: no false success.
3. Register tool in `src/index.ts`.
4. Add `tests/append-doc.test.ts` with mocked Docs client.

### Behavior checklist

| Case | Expected |
|------|----------|
| Raw document ID | Accepted |
| Valid Docs URL | ID parsed |
| Unrelated URL / empty ID | Rejected |
| Empty content | Rejected |
| API request shape | `insertText` + `endOfSegmentLocation` |
| Empty vs non-empty doc | Correct newline behavior |
| API error | Error returned; no success claim |

### Exit criteria

- [ ] Append path uses end-of-segment insert only.
- [ ] Unit tests for Phase 5 cases pass.
- [ ] No code paths that delete or overwrite document content.

### Manual smoke (optional)

- Append a unique string to a throwaway Doc you own; verify it appears at the end without replacing prior text.

---

## Phase 6 — Registration polish, Cursor integration, README

**Goal:** Both tools discoverable in Cursor with documented setup.

### Tasks

1. Finalize tool names, descriptions, and schemas so the agent knows **when** and **how** to call each tool (especially `confirm_send`).
2. Confirm `src/index.ts` registers **exactly two** MVP tools.
3. Add example `.cursor/mcp.json` launching `node` on the built entry with env paths (per architecture).
4. Write `README.md` covering:
   - What the server does / does not do
   - Google Cloud setup
   - Env vars and secret handling
   - `npm run auth`
   - Build + Cursor MCP config + refresh MCP servers
   - Testing
   - Troubleshooting (auth, scopes, stdout pollution, Doc permissions, ambiguous send)
   - Note on OAuth consent publishing for personal vs public distribution
5. Align error handling across both tools with the problem statement’s error list.
6. Double-check logging policy (stderr only; no email bodies/tokens).

### Files

| Path | Purpose |
|------|---------|
| `.cursor/mcp.json` | Example Cursor stdio config |
| `README.md` | Operator documentation |
| `src/index.ts` | Final tool registration |
| Tool modules | Description / schema polish |

### Exit criteria

- [ ] Cursor can launch the server and lists both tools.
- [ ] README alone is enough for a new machine setup (assuming GCP access).
- [ ] Example `mcp.json` matches current Cursor MCP config shape (adjust if docs differ).

### Verification steps

1. `npm run build`
2. Configure `.cursor/mcp.json` with real local paths.
3. Restart/refresh MCP in Cursor.
4. Confirm tools `send_email` and `append_to_google_doc` appear.
5. Ask Cursor for a **preview** email (must not send).
6. Ask Cursor to append a short line to a known Doc URL.

---

## Phase 7 — Hardening, full suite, acceptance

**Goal:** Meet every acceptance criterion; green build and tests.

### Tasks

1. Complete remaining automated tests:
   - `tests/send-email.test.ts`
   - `tests/append-doc.test.ts`
   - `tests/validation.test.ts`
   - MCP server tests: exactly two tools registered; schemas reject invalid args; no diagnostic stdout (as feasible).
2. Audit for:
   - Accidental retries on Gmail timeout
   - Fixed character indices in Docs writes
   - Extra OAuth scopes
   - Secrets in logs or git status
3. Run full `npm test` and `npm run build`; fix all failures.
4. Walk the acceptance checklist below end-to-end.
5. Document any intentional deviation from the problem statement in the README.

### Acceptance checklist (definition of done)

- [ ] Project builds and starts locally without TypeScript errors.
- [ ] First-run OAuth authorizes a Google account and persists credentials for local personal use.
- [ ] Cursor launches the MCP server via `.cursor/mcp.json` and discovers both tools.
- [ ] `send_email` sends plain-text mail only after explicit confirmation (`confirm_send: true`).
- [ ] Preview invocation of `send_email` never sends.
- [ ] `append_to_google_doc` appends without replacing existing content.
- [ ] Both tools return clear success details and actionable errors.
- [ ] Unit tests cover critical behavior with mocked APIs.
- [ ] README documents setup, OAuth, Cursor integration, testing, and troubleshooting.
- [ ] No secrets or token files are committed to the repository.

### Exit criteria

- [ ] All acceptance items checked.
- [ ] Test suite green.
- [ ] Ready to treat MVP as complete.

---

## Suggested effort order (summary)

```text
Phase 0  Google Cloud + client JSON (human)
   │
Phase 1  Scaffold + MCP stdio
   │
Phase 2  Config + OAuth + npm run auth
   │
Phase 3  Validation + error mapping (+ validation tests)
   │
Phase 4  Gmail service + send_email (+ tests)
   │
Phase 5  Docs service + append_to_google_doc (+ tests)
   │
Phase 6  Cursor mcp.json + README + tool description polish
   │
Phase 7  Full suite + acceptance sign-off
```

---

## Dependency map

```text
config/auth (Phase 2) ──► gmail.ts / docs.ts (Phases 4–5)
validation/errors (Phase 3) ──► tools (Phases 4–5)
tools (Phases 4–5) ──► index registration (Phase 6)
all code ──► acceptance (Phase 7)
```

---

## Explicit deferrals (do not implement in these phases)

- Gmail read/search/label/delete, drafts, replies, forwards, attachments, HTML
- Creating Docs, Drive search, permission changes, rich text, templates
- Multi-account, remote hosting, HTTP transport, web UI
- Auto-send without `confirm_send: true`

---

## Tracking template (copy per phase)

```markdown
### Phase N — <name>
Status: not started | in progress | blocked | done
Owner:
Started:
Finished:
Blockers:
Notes / deviations from problemstatement.md:
Exit criteria: met / not met
```

---

## References to keep open while implementing

- [`problemstatement.md`](./problemstatement.md) — requirements and acceptance
- [`architecture.md`](./architecture.md) — layers, flows, safety rules
- Cursor MCP docs (current config shape)
- MCP TypeScript SDK v2 docs
- Gmail `users.messages.send` + MIME send guide
- Docs `documents.batchUpdate` + `InsertTextRequest`
- Google Workspace: enable APIs + create desktop OAuth credentials
