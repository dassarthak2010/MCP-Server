/**
 * Vercel Function — Streamable HTTP MCP endpoint.
 * Public URL: https://<project>.vercel.app/api/mcp
 */

import { handleMcpHttpRequest } from "../src/http/mcp-app.js";

export const maxDuration = 60;

async function handler(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request);
}

export function GET(request: Request): Promise<Response> {
  return handler(request);
}

export function POST(request: Request): Promise<Response> {
  return handler(request);
}

export function DELETE(request: Request): Promise<Response> {
  return handler(request);
}

export default { fetch: handler };
