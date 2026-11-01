/**
 * Safe, user-readable error mapping for MCP tool responses.
 * Never expose tokens, client secrets, or raw stack traces.
 */

export class AppError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

function extractGoogleStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as {
    code?: number | string;
    response?: { status?: number };
    status?: number;
  };
  if (typeof e.response?.status === "number") return e.response.status;
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  if (typeof e.code === "string" && /^\d+$/.test(e.code)) return Number(e.code);
  return undefined;
}

function extractGoogleMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as {
    message?: string;
    errors?: Array<{ message?: string }>;
    response?: { data?: { error?: { message?: string } } };
  };
  const fromBody = e.response?.data?.error?.message;
  if (fromBody && typeof fromBody === "string") return fromBody;
  if (Array.isArray(e.errors) && e.errors[0]?.message) return e.errors[0].message;
  if (typeof e.message === "string") return e.message;
  return undefined;
}

/**
 * Map unknown failures (including googleapis errors) to concise, actionable text.
 */
export function toSafeErrorMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.message;
  }

  const status = extractGoogleStatus(error);
  const apiMessage = extractGoogleMessage(error)?.trim();

  // Auth / consent issues
  if (
    status === 401 ||
    /invalid_grant|invalid credentials|unauthorized|login required|token/i.test(
      apiMessage ?? "",
    )
  ) {
    return (
      "Google authorization failed or expired. Run `npm run auth` to re-authorize " +
      "this app for your Google account, then try again."
    );
  }

  if (
    status === 403 &&
    /insufficient|scope|access_denied|permission/i.test(apiMessage ?? "")
  ) {
    return (
      "Required OAuth scope was not granted (need gmail.send and documents). " +
      "Run `npm run auth` again and approve both permissions."
    );
  }

  if (status === 403) {
    return (
      "Access denied by Google. Confirm the authenticated account can perform this action " +
      "and that the Gmail/Docs APIs are enabled in your Google Cloud project." +
      (apiMessage ? ` Details: ${sanitizeApiMessage(apiMessage)}` : "")
    );
  }

  if (status === 404) {
    return (
      "Resource not found or inaccessible to the authenticated user. " +
      "Check the document ID/URL and sharing permissions." +
      (apiMessage ? ` Details: ${sanitizeApiMessage(apiMessage)}` : "")
    );
  }

  if (status === 429 || status === 503) {
    return (
      "Google API rate limit, quota, or temporary service error. Wait and try again later." +
      (apiMessage ? ` Details: ${sanitizeApiMessage(apiMessage)}` : "")
    );
  }

  // Ambiguous network / timeout — callers for send must not auto-retry
  if (
    isTimeoutLike(error) ||
    /timeout|ETIMEDOUT|ECONNRESET|socket hang up|network/i.test(apiMessage ?? "")
  ) {
    return (
      "Network timeout or connection error. The operation result may be uncertain. " +
      "For email sends, check Gmail Sent mail before trying again to avoid duplicates. " +
      "This server does not automatically retry sends after an ambiguous timeout."
    );
  }

  if (apiMessage) {
    return sanitizeApiMessage(apiMessage);
  }

  if (error instanceof Error && error.message) {
    return sanitizeApiMessage(error.message);
  }

  return "An unexpected error occurred while calling Google APIs.";
}

export function isTimeoutLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; name?: string; message?: string };
  if (e.code === "ETIMEDOUT" || e.code === "ESOCKETTIMEDOUT" || e.code === "ECONNRESET") {
    return true;
  }
  if (e.name === "AbortError") return true;
  if (typeof e.message === "string" && /timeout/i.test(e.message)) return true;
  return false;
}

function sanitizeApiMessage(message: string): string {
  // Strip anything that looks like a token or secret fragment
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[A-Za-z0-9._~+/=-]+/g, "[redacted]")
    .replace(/1\/\/[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/client_secret["\s:=]+["']?[^"'\s]+/gi, "client_secret=[redacted]")
    .slice(0, 500);
}

export function toolErrorResult(error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text", text: toSafeErrorMessage(error) }],
    isError: true,
  };
}

export function toolTextResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text }],
  };
}
