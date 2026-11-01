import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AppError } from "./errors.js";

/** How Google OAuth client credentials are supplied. */
export type ClientCredentialSource =
  | { kind: "file"; path: string }
  | { kind: "json"; json: string }
  | { kind: "parts"; clientId: string; clientSecret: string };

/** How the authorized user token blob is supplied. */
export type TokenCredentialSource =
  | { kind: "file"; path: string }
  | { kind: "json"; json: string };

export interface AppConfig {
  client: ClientCredentialSource;
  token: TokenCredentialSource;
}

function trimEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

/**
 * Resolve configuration from environment variables.
 *
 * Local (stdio / `npm run auth`):
 * - `GOOGLE_OAUTH_CLIENT_PATH` + `GOOGLE_OAUTH_TOKEN_PATH`
 *
 * Hosted (Vercel Path A):
 * - `GOOGLE_OAUTH_CLIENT_JSON` **or** `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET`
 * - `GOOGLE_OAUTH_TOKEN_JSON` (contents of a locally generated `token.json`)
 *
 * File paths and env JSON can be mixed (e.g. client file + token JSON).
 */
export function loadConfig(options?: { requireClientFile?: boolean }): AppConfig {
  const requireClientPresent = options?.requireClientFile ?? true;
  const client = resolveClientSource();
  const token = resolveTokenSource();

  if (requireClientPresent && client.kind === "file" && !existsSync(client.path)) {
    throw new AppError(
      `OAuth client configuration file not found or unreadable at: ${client.path}. ` +
        "Download the Desktop app OAuth client JSON from Google Cloud Console and place it there, " +
        "or set GOOGLE_OAUTH_CLIENT_JSON / GOOGLE_OAUTH_CLIENT_ID+SECRET for hosted deploys.",
      "CONFIG_CLIENT_MISSING",
    );
  }

  return { client, token };
}

function resolveClientSource(): ClientCredentialSource {
  const clientJson = trimEnv("GOOGLE_OAUTH_CLIENT_JSON");
  if (clientJson) {
    return { kind: "json", json: clientJson };
  }

  const clientId = trimEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = trimEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  if (clientId && clientSecret) {
    return { kind: "parts", clientId, clientSecret };
  }
  if (clientId || clientSecret) {
    throw new AppError(
      "Set both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET, " +
        "or provide GOOGLE_OAUTH_CLIENT_JSON / GOOGLE_OAUTH_CLIENT_PATH.",
      "CONFIG_MISSING",
    );
  }

  const clientPath = trimEnv("GOOGLE_OAUTH_CLIENT_PATH");
  if (clientPath) {
    return { kind: "file", path: resolve(clientPath) };
  }

  throw new AppError(
    "Google OAuth client credentials are not configured. Set GOOGLE_OAUTH_CLIENT_PATH " +
      "(local file), GOOGLE_OAUTH_CLIENT_JSON, or GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET.",
    "CONFIG_MISSING",
  );
}

function resolveTokenSource(): TokenCredentialSource {
  const tokenJson = trimEnv("GOOGLE_OAUTH_TOKEN_JSON");
  if (tokenJson) {
    return { kind: "json", json: tokenJson };
  }

  const tokenPath = trimEnv("GOOGLE_OAUTH_TOKEN_PATH");
  if (tokenPath) {
    return { kind: "file", path: resolve(tokenPath) };
  }

  throw new AppError(
    "Google OAuth token is not configured. Set GOOGLE_OAUTH_TOKEN_PATH (local file after " +
      "`npm run auth`) or GOOGLE_OAUTH_TOKEN_JSON (hosted / Vercel).",
    "CONFIG_MISSING",
  );
}

export function assertTokenFileExists(tokenPath: string): void {
  if (!existsSync(tokenPath)) {
    throw new AppError(
      `No OAuth token found at: ${tokenPath}. Run \`npm run auth\` once to authorize your Google account.`,
      "AUTH_REQUIRED",
    );
  }
}

/** True when tokens come from env and cannot be persisted across invocations. */
export function isEphemeralTokenStore(config?: AppConfig): boolean {
  const cfg = config ?? loadConfig({ requireClientFile: false });
  return cfg.token.kind === "json";
}
