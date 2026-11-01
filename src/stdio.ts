#!/usr/bin/env node
/**
 * Google Workspace MCP server entry point (stdio transport).
 * Logs must go to stderr only — stdout is reserved for MCP JSON-RPC.
 *
 * Kept off src/index.ts / src/server.ts so Vercel’s backends auto-detect
 * does not treat the local stdio process as an HTTP app entrypoint.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const handle = serveStdio(createServer);

console.error(
  `${SERVER_NAME} MCP server v${SERVER_VERSION} listening on stdio (tools: send_email, append_to_google_doc)`,
);

process.on("SIGINT", () => {
  void handle.close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void handle.close().finally(() => process.exit(0));
});
