import { McpServer } from "@modelcontextprotocol/server";
import { registerAppendDocTool } from "./tools/append-doc.js";
import { registerSendEmailTool } from "./tools/send-email.js";

export const SERVER_NAME = "google-workspace";
export const SERVER_VERSION = "1.0.0";

/** MVP tool names advertised to MCP clients. */
export const MVP_TOOL_NAMES = ["send_email", "append_to_google_doc"] as const;

/**
 * Build an MCP server instance with both Workspace tools registered.
 * Side-effect free — safe for unit tests.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerSendEmailTool(server);
  registerAppendDocTool(server);

  return server;
}
