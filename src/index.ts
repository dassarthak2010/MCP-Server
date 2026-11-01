#!/usr/bin/env node
/**
 * Google Workspace MCP server entry point (stdio transport).
 * Logs must go to stderr only — stdout is reserved for MCP JSON-RPC.
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
