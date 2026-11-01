Problem Statement: Google Workspace MCP Server for Cursor
1. Objective
Build a local Model Context Protocol (MCP) server that Cursor can connect to and use to perform two Google Workspace actions on behalf of the authenticated user:
1. Send an email through Gmail.
2. Append text to an existing Google Doc.
The server should expose these actions as clearly described MCP tools. Cursor Agent should be able to invoke them from a conversation using the information supplied by the user, without requiring the user to write API calls or scripts.

This is a single-user, local development tool for personal use. The first implementation should prioritize reliability, clear permissions, safe handling of credentials, and simple setup over broad Google Workspace coverage.
2. Intended user experience
After setup, the user should be able to ask Cursor to do things such as:
- “Send an email to alex@example.com with the subject ‘Project update’ and this message: …”
- “Append these meeting notes to this Google Doc: https://docs.google.com/document/d/DOCUMENT_ID/edit”
Cursor should select the appropriate MCP tool, collect any missing required details, and call the tool with structured arguments.

For email, the assistant must show the recipient(s), subject, and message body and obtain the user's explicit approval before sending. A tool call without explicit send confirmation must not send the email.

For Google Docs, the tool must append the supplied text to the end of the specified document. It must not replace or delete existing content.
3. Scope
In scope
- Local MCP server using the stdio transport so Cursor can launch it as a child process.
- TypeScript implementation on Node.js.
- Google OAuth 2.0 authorization for the user's own Google account.
- Gmail API integration for sending email.
- Google Docs API integration for appending text to an existing document.
- Input validation, useful error messages, and basic automated tests.
- Setup instructions and a Cursor .cursor/mcp.json example.
Out of scope for the first version
- Reading, searching, labeling, or deleting Gmail messages.
- Creating drafts, replying to threads, forwarding emails, or attaching files.
- Creating new Google Docs, searching Drive, or changing document permissions.
- Rich text formatting, tables, images, comments, or document templates.
- Multiple Google accounts, team-wide deployment, remote hosting, or a web UI.
- Sending email automatically based only on inferred intent, without explicit user approval.
4. MCP tools to expose
The server must expose the following two tools. Tool names and descriptions should be written so an AI assistant can understand when and how to use them.
Tool A: send_email
Purpose: Send a plain-text email from the Google account that authorized the MCP server.

Input schema:
Field	Type	Required	Description
to	array of email strings	Yes	One or more primary recipients.
subject	string	Yes	Email subject. An empty subject should be rejected unless explicitly supported as an intentional choice.
body	string	Yes	Plain-text email body. Preserve line breaks.
cc	array of email strings	No	Carbon-copy recipients.
bcc	array of email strings	No	Blind-carbon-copy recipients.
confirm_send	boolean	Yes	Must be true to send. When false, return a preview and do not call Gmail's send endpoint.


Behavior:
1. Validate that to contains at least one syntactically valid email address. Validate cc and bcc when supplied.
2. Reject missing or whitespace-only subject/body values. Trim surrounding whitespace from addresses and subject, but preserve meaningful body formatting.
3. When confirm_send is false, return a preview containing the recipients, subject, and body, and clearly state that nothing was sent.
4. When confirm_send is true, construct a standards-compliant MIME email, encode it as Base64 URL-safe text, and call Gmail API users.messages.send with userId: "me".
5. On success, return a concise confirmation and the Gmail message ID. Do not claim success unless Gmail returns a successful response.
6. Do not automatically retry a send request after an ambiguous network timeout. Report that the result may be uncertain and advise the user to check Sent mail before trying again, to reduce the risk of duplicate emails.
Safety requirements:
- The tool description must tell the model to use this tool only when the user has explicitly asked to send an email.
- The model should present the final recipient list, subject, and body and obtain confirmation before invoking with confirm_send: true.
- A preview call (confirm_send: false) must never send an email.
- No default recipient, subject, or body may be invented by the server.
MVP limitations: Plain-text email only. HTML and attachments are not required.
Tool B: append_to_google_doc
Purpose: Append plain text to the end of an existing Google Doc.

Input schema:
Field	Type	Required	Description
document_id_or_url	string	Yes	Google Docs document ID or full document URL.
content	string	Yes	Text to append. Preserve supplied line breaks and Unicode characters.


Behavior:
1. Accept either a raw Google Docs document ID or a URL in the form https://docs.google.com/document/d/{documentId}/....
2. Extract and validate the document ID. Reject unrelated URLs and empty IDs.
3. Reject empty or whitespace-only content.
4. Use the Google Docs API documents.get if needed to determine whether the body already contains substantive text. Add a separating newline when appropriate so appended content does not run into the previous paragraph. Do not add unnecessary blank paragraphs to an otherwise empty document.
5. Append the supplied content using documents.batchUpdate and an insertText request with endOfSegmentLocation targeting the document body. Do not use a fixed character index, because the document may have changed since it was last read.
6. Add a trailing newline to the inserted block when needed to keep subsequent edits on a new paragraph. Preserve the actual content and its internal line breaks.
7. Return a success message with the document ID and a link to the document. Report API errors without claiming the content was appended.
Safety requirements:
- Only append. Never clear, overwrite, truncate, or delete existing document content.
- Do not create a new document if the supplied document cannot be found.
- Do not change sharing or access permissions.
- Do not infer a document from an ambiguous title; require a document ID or URL.
5. Authentication and Google Cloud setup
Use OAuth 2.0 for a desktop/installed application, because this MCP server runs locally and accesses the user's own Google account. Do not use a service-account key for the normal personal-account flow.

The implementation must include a first-run authorization command, for example npm run auth, which:
1. Reads the OAuth desktop-app client credentials configured by the user.
2. Opens the Google authorization page in a browser (or prints the URL if automatic browser opening is unavailable).
3. Requests consent for only the scopes required by the two features.
4. Receives the authorization response using a local loopback callback or another supported installed-app flow.
5. Stores the resulting refresh/access token data locally so the user does not have to authorize on every server start.
6. Refreshes access tokens when required and reports when reauthorization is needed.
Minimum OAuth scopes:
- Gmail send: https://www.googleapis.com/auth/gmail.send
- Google Docs edit: https://www.googleapis.com/auth/documents
Do not request broad Gmail or Google Drive scopes unless a later feature genuinely requires them.

Google Cloud project setup must be documented:
1. Create or select a Google Cloud project.
2. Enable the Gmail API and Google Docs API.
3. Configure the Google Auth Platform / OAuth consent screen and add the user's account as a test user when the app is in testing mode.
4. Create an OAuth client ID with application type Desktop app.
5. Download the client configuration file and place it in the local path expected by the server.
6. Run the authorization command once, then restart or refresh the MCP server in Cursor.
The README must explain that Google OAuth consent-screen publishing and verification requirements can depend on how the app is configured and distributed. This project is intended for personal/local use, not public distribution.
6. Technical requirements
Runtime and libraries
- Use TypeScript and the current stable MCP TypeScript server SDK. At the time this specification was written, the SDK v2 package is @modelcontextprotocol/server; do not mix v1 and v2 package APIs.
- Use the MCP stdio transport for Cursor's local process integration.
- Use Google's maintained Node.js client library (googleapis) or an equivalent maintained Google API client for Gmail and Docs.
- Use a schema-validation library such as Zod for MCP tool inputs.
- Use the current Node.js LTS release supported by the selected SDK and dependencies.
- Pin compatible dependency versions in the package manifest and commit the lockfile.
Process and logging
- MCP protocol messages must be written only to stdout.
- Write diagnostic logs to stderr; never use console.log for ordinary server diagnostics.
- The process should start quickly and should return clear MCP tool errors when configuration or authentication is missing.
- Do not start an HTTP server for the initial implementation.
Suggested project structure
google-workspace-mcp/
├── src/
│   ├── index.ts                 # MCP server entry point and stdio transport
│   ├── auth/
│   │   ├── google-auth.ts       # OAuth client, token loading and refresh
│   │   └── authorize.ts         # One-time browser authorization flow
│   ├── tools/
│   │   ├── send-email.ts        # send_email tool implementation
│   │   └── append-doc.ts        # append_to_google_doc implementation
│   ├── services/
│   │   ├── gmail.ts             # Gmail API operations and MIME construction
│   │   └── docs.ts              # Google Docs API operations
│   └── utils/
│       ├── validation.ts        # Email and document ID/URL validation
│       └── errors.ts            # Safe, user-readable error mapping
├── tests/
│   ├── send-email.test.ts
│   ├── append-doc.test.ts
│   └── validation.test.ts
├── .gitignore
├── .cursor/
│   └── mcp.json                 # Example local Cursor MCP configuration
├── package.json
├── tsconfig.json
└── README.md
The exact structure may change if there is a simpler implementation, but keep authentication, Google API operations, and MCP tool registration logically separated.
7. Configuration and secret management
Support environment variables or a clearly documented local configuration path for:
- GOOGLE_OAUTH_CLIENT_PATH: path to the downloaded OAuth desktop client JSON.
- GOOGLE_OAUTH_TOKEN_PATH: path where the authorized user's token data is stored.
Requirements:
- Never hardcode client credentials, access tokens, refresh tokens, or personal email addresses.
- Never commit OAuth client JSON or token files to Git.
- Add credential and token paths/files to .gitignore.
- Prefer the operating system's secure credential store for refresh tokens when practical. If a local token file is used for the MVP, store it outside the repository, restrict file permissions where supported, and document the risk.
- Never print tokens, client secrets, email bodies, or other sensitive payloads in logs.
- Provide a clear setup error if the client credentials or token file is missing.
8. Cursor integration
Provide a project-level .cursor/mcp.json example using the stdio server configuration. It should launch the built JavaScript entry point and pass the credential paths through environment variables, for example:
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
The README must explain the workflow:
1. Install dependencies.
2. Configure Google Cloud and save the OAuth client JSON outside the repository.
3. Set the two configuration paths.
4. Run the one-time authorization command.
5. Build the project.
6. Add or adjust .cursor/mcp.json for the local paths.
7. Restart or refresh MCP servers in Cursor and verify that both tools appear.
If the selected Cursor version uses a slightly different MCP configuration shape, follow the current Cursor documentation and update the example accordingly.
9. Error handling
Return concise, actionable errors for at least these cases:
- OAuth client configuration missing or unreadable.
- User has not authorized the app, authorization expired, or refresh failed.
- Required OAuth scope was not granted.
- Invalid recipient email address.
- Missing recipient, subject, or email body.
- confirm_send is false and no send was performed.
- Invalid Google Docs URL or document ID.
- Document not found, inaccessible, or not editable by the authenticated user.
- Google API rate limit, quota, or temporary service error.
- Network timeout or ambiguous Gmail send result.
Do not expose raw stack traces, access tokens, refresh tokens, or secrets to the model. Preserve useful HTTP status/error details when safe.
10. Testing requirements
Use unit tests with mocked Google API clients. Tests must not send real email or modify real documents.

At minimum, verify:
send_email
- Valid to, subject, and body produce a valid Gmail API request.
- cc and bcc headers are included when supplied.
- Body line breaks and non-ASCII characters are preserved.
- Invalid or missing recipient data is rejected.
- confirm_send: false returns a preview and makes zero Gmail API calls.
- confirm_send: true makes exactly one send request.
- An ambiguous send timeout is not automatically retried.
append_to_google_doc
- A raw document ID is accepted.
- A valid Google Docs URL is parsed correctly.
- An unrelated URL and empty ID are rejected.
- Empty content is rejected.
- The API request uses insertText with endOfSegmentLocation.
- Existing content is not deleted or replaced.
- Newline behavior is correct for both empty and non-empty documents.
- API errors are returned without a false success response.
MCP server
- Server starts over stdio and registers exactly the two required tools for the MVP.
- Tool input schemas reject invalid arguments.
- No diagnostic output is written to stdout.
11. Acceptance criteria
The implementation is complete when all of the following are true:
- [ ] The project builds and starts locally without TypeScript errors.
- [ ] The first-run OAuth process authorizes a Google account and persists credentials securely enough for local personal use.
- [ ] Cursor can launch the MCP server using .cursor/mcp.json and discovers both tools.
- [ ] send_email sends a plain-text email through the authenticated Gmail account only after explicit confirmation.
- [ ] A preview invocation of send_email never sends anything.
- [ ] append_to_google_doc appends supplied text to the end of an existing Google Doc without replacing existing content.
- [ ] Both tools return clear success details and actionable errors.
- [ ] Unit tests cover the critical behavior and use mocked APIs.
- [ ] README documents setup, OAuth, Cursor integration, testing, and troubleshooting.
- [ ] No secrets or token files are committed to the repository.
12. Implementation approach
Implement in this order:
1. Scaffold the TypeScript project and configure the current stable MCP SDK with stdio transport.
2. Implement Google OAuth setup, token persistence, and a small authentication check.
3. Implement and test the Gmail MIME message builder and send_email tool.
4. Implement and test document ID parsing and append_to_google_doc using documents.batchUpdate.
5. Register both tools with clear names, descriptions, and validated input schemas.
6. Add Cursor configuration, README, error handling, and final tests.
7. Run the build and test suite; fix all failures before calling the project complete.
Implementation instruction for Cursor Agent: Treat this file as the source of truth. Build the working MCP server, not just a code sample. Make reasonable implementation decisions where details are unspecified, keep the first version limited to the two tools above, and document any deviation from this specification.
13. Official references
Use the current official documentation while implementing; API and SDK details may change.
- Cursor MCP documentation
- MCP TypeScript SDK v2 documentation
- Gmail API: Create and send email messages
- Gmail API: users.messages.send
- Google Docs API: documents.batchUpdate
- Google Docs API: InsertTextRequest
- Google Workspace: Create access credentials
- Google Workspace: Enable APIs