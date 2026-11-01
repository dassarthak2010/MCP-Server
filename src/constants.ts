/** Shared identity constants — safe to import from lightweight routes (e.g. /api/health). */

export const SERVER_NAME = "google-workspace";
export const SERVER_VERSION = "1.0.0";

/** MVP tool names advertised to MCP clients. */
export const MVP_TOOL_NAMES = ["send_email", "append_to_google_doc"] as const;
