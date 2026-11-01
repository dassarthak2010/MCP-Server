/**
 * Streamable HTTP MCP application (shared by Vercel Functions and local HTTP).
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { SERVER_NAME } from "../constants.js";
import { createServer } from "../server.js";
import { unauthorizedMcpResponse } from "./bearer-auth.js";

const mcpHandler = createMcpHandler(() => createServer(), {
  // Prefer JSON responses for short Gmail/Docs tool calls on serverless.
  responseMode: "json",
  onerror: (error) => {
    console.error(`[${SERVER_NAME}] MCP HTTP error: ${error.message}`);
  },
});

/**
 * Handle one MCP HTTP request (Streamable HTTP).
 * Enforces bearer auth when MCP_AUTH_TOKEN is set or when running on Vercel.
 */
export async function handleMcpHttpRequest(request: Request): Promise<Response> {
  const denied = unauthorizedMcpResponse(request);
  if (denied) return denied;
  return mcpHandler.fetch(request);
}

export { mcpHandler };
