/**
 * Shared-secret bearer gate for the remote MCP HTTP endpoint.
 * Never logs the token value.
 */

export function getExpectedMcpAuthToken(): string | undefined {
  const token = process.env.MCP_AUTH_TOKEN?.trim();
  return token || undefined;
}

/**
 * Returns an HTTP error Response when the request must be rejected;
 * otherwise returns undefined and the caller may proceed.
 */
export function unauthorizedMcpResponse(request: Request): Response | undefined {
  const expected = getExpectedMcpAuthToken();
  const requireAuth =
    process.env.REQUIRE_MCP_AUTH === "true" ||
    process.env.VERCEL === "1" ||
    Boolean(expected);

  if (!requireAuth) {
    return undefined;
  }

  if (!expected) {
    return new Response(
      "Server misconfigured: MCP_AUTH_TOKEN is required for the HTTP MCP endpoint.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "WWW-Authenticate": 'Bearer realm="google-workspace-mcp"',
      },
    });
  }

  const presented = header.slice("Bearer ".length).trim();
  if (!presented || !timingSafeEqualString(presented, expected)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "WWW-Authenticate": 'Bearer realm="google-workspace-mcp"',
      },
    });
  }

  return undefined;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self to keep runtime roughly constant on length mismatch.
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < aBuf.length; i++) {
    mismatch |= aBuf[i]! ^ bBuf[i]!;
  }
  return mismatch === 0;
}
