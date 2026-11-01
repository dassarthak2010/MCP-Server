import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { google } from "googleapis";
import {
  loadConfig,
  assertTokenFileExists,
  isEphemeralTokenStore,
  type AppConfig,
  type ClientCredentialSource,
  type TokenCredentialSource,
} from "../utils/config.js";
import { AppError } from "../utils/errors.js";

/** Use the OAuth2 client type that `googleapis` itself depends on (avoid duplicate package types). */
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export interface TokenData {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
}

/** Minimum scopes for the MVP tools. */
export const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/documents",
] as const;

interface InstalledClientJson {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
}

export function parseOAuthClientJson(raw: string): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  let parsed: InstalledClientJson;
  try {
    parsed = JSON.parse(raw) as InstalledClientJson;
  } catch {
    throw new AppError(
      "OAuth client JSON is invalid. Provide Desktop/Web client JSON from Google Cloud Console.",
      "CONFIG_CLIENT_INVALID",
    );
  }

  const block = parsed.installed ?? parsed.web;
  if (!block?.client_id || !block?.client_secret) {
    throw new AppError(
      "OAuth client JSON is missing client_id or client_secret. " +
        "Use a Desktop app OAuth client downloaded from Google Cloud Console.",
      "CONFIG_CLIENT_INVALID",
    );
  }

  const redirectUri =
    block.redirect_uris?.find((u) => u.includes("localhost") || u.includes("127.0.0.1")) ??
    "http://127.0.0.1";

  return {
    clientId: block.client_id,
    clientSecret: block.client_secret,
    redirectUri,
  };
}

function resolveClientCredentials(source: ClientCredentialSource): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  if (source.kind === "parts") {
    return {
      clientId: source.clientId,
      clientSecret: source.clientSecret,
      redirectUri: "http://127.0.0.1",
    };
  }

  if (source.kind === "json") {
    return parseOAuthClientJson(source.json);
  }

  let raw: string;
  try {
    raw = readFileSync(source.path, "utf8");
  } catch {
    throw new AppError(
      `OAuth client configuration file not found or unreadable at: ${source.path}`,
      "CONFIG_CLIENT_MISSING",
    );
  }
  return parseOAuthClientJson(raw);
}

/**
 * Read OAuth client credentials from a file path (used by `npm run auth`).
 */
export function readOAuthClientCredentials(clientPath: string): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  return resolveClientCredentials({ kind: "file", path: clientPath });
}

export function createOAuth2Client(config?: AppConfig): OAuth2Client {
  const cfg = config ?? loadConfig();
  const { clientId, clientSecret, redirectUri } = resolveClientCredentials(cfg.client);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function saveTokens(tokenPath: string, tokens: TokenData): void {
  const dir = dirname(tokenPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    // Best-effort on platforms that ignore mode
  }
}

function loadTokensFromSource(source: TokenCredentialSource): TokenData {
  if (source.kind === "json") {
    try {
      return JSON.parse(source.json) as TokenData;
    } catch {
      throw new AppError(
        "GOOGLE_OAUTH_TOKEN_JSON is not valid JSON. Paste the contents of token.json from a local `npm run auth`.",
        "AUTH_TOKEN_INVALID",
      );
    }
  }

  assertTokenFileExists(source.path);
  try {
    return JSON.parse(readFileSync(source.path, "utf8")) as TokenData;
  } catch {
    throw new AppError(
      `OAuth token file at ${source.path} is unreadable or invalid JSON. Run \`npm run auth\` again.`,
      "AUTH_TOKEN_INVALID",
    );
  }
}

export function loadTokens(tokenPath: string): TokenData {
  return loadTokensFromSource({ kind: "file", path: tokenPath });
}

/**
 * Returns an OAuth2 client with loaded tokens and automatic persistence on refresh
 * when tokens are file-backed. Env-backed tokens (Vercel) stay in-memory for the
 * invocation only — re-export an updated GOOGLE_OAUTH_TOKEN_JSON if refresh fails permanently.
 */
export async function getAuthorizedClient(config?: AppConfig): Promise<OAuth2Client> {
  const cfg = config ?? loadConfig();
  const client = createOAuth2Client(cfg);
  const tokens = loadTokensFromSource(cfg.token);
  client.setCredentials(tokens);

  if (cfg.token.kind === "file") {
    const tokenPath = cfg.token.path;
    client.on("tokens", (newTokens) => {
      const merged: TokenData = { ...tokens, ...newTokens };
      try {
        saveTokens(tokenPath, merged);
      } catch {
        // Persistence failure should not crash an in-flight request
      }
    });
  }

  if (!tokens.access_token || isLikelyExpired(tokens)) {
    try {
      const refreshed = await client.getAccessToken();
      if (!refreshed.token) {
        throw new AppError(
          "Failed to refresh Google access token. Run `npm run auth` to re-authorize" +
            (isEphemeralTokenStore(cfg)
              ? " locally and update GOOGLE_OAUTH_TOKEN_JSON on Vercel."
              : "."),
          "AUTH_REFRESH_FAILED",
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "Google authorization expired or refresh failed. Run `npm run auth` to re-authorize" +
          (isEphemeralTokenStore(cfg)
            ? " locally and update GOOGLE_OAUTH_TOKEN_JSON on Vercel."
            : "."),
        "AUTH_REFRESH_FAILED",
      );
    }
  }

  return client;
}

function isLikelyExpired(tokens: TokenData): boolean {
  if (!tokens.expiry_date) return false;
  return Date.now() >= tokens.expiry_date - 60_000;
}

export function hasTokenFile(tokenPath?: string): boolean {
  const path = tokenPath ?? process.env.GOOGLE_OAUTH_TOKEN_PATH;
  return Boolean(path && existsSync(path));
}

export function getGmailClient(auth: OAuth2Client) {
  return google.gmail({ version: "v1", auth });
}

export function getDocsClient(auth: OAuth2Client) {
  return google.docs({ version: "v1", auth });
}
