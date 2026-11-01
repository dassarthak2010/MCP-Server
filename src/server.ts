import { McpServer } from "@modelcontextprotocol/server";
import { registerAppendDocTool } from "./tools/append-doc.js";
import { registerSendEmailTool } from "./tools/send-email.js";
import {
  MVP_TOOL_NAMES,
  SERVER_NAME,
  SERVER_VERSION,
} from "./constants.js";

export { MVP_TOOL_NAMES, SERVER_NAME, SERVER_VERSION };

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
