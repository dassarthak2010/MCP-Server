/**
 * Lightweight health check for Vercel / uptime monitors.
 * Does not require MCP bearer auth and does not call Google.
 * Imports only constants — avoid pulling MCP/googleapis into this function.
 */

import { SERVER_NAME, SERVER_VERSION } from "../src/constants.js";

export function GET(): Response {
  return Response.json({
    ok: true,
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
}

export default {
  fetch(): Response {
    return GET();
  },
};
