/**
 * One-time browser OAuth authorization for a desktop/installed app.
 * Usage: npm run auth
 *
 * Writes tokens to GOOGLE_OAUTH_TOKEN_PATH. Never prints secrets.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import open from "open";
import { google } from "googleapis";
import { loadConfig } from "../utils/config.js";
import { AppError, toSafeErrorMessage } from "../utils/errors.js";
import {
  OAUTH_SCOPES,
  readOAuthClientCredentials,
  saveTokens,
} from "./google-auth.js";

async function authorize(): Promise<void> {
  const config = loadConfig({ requireClientFile: true });

  if (config.client.kind !== "file") {
    throw new AppError(
      "`npm run auth` requires GOOGLE_OAUTH_CLIENT_PATH pointing at a Desktop OAuth client JSON file.",
      "CONFIG_MISSING",
    );
  }
  if (config.token.kind !== "file") {
    throw new AppError(
      "`npm run auth` requires GOOGLE_OAUTH_TOKEN_PATH (where token.json will be written). " +
        "For Vercel, copy that file's contents into GOOGLE_OAUTH_TOKEN_JSON after auth succeeds.",
      "CONFIG_MISSING",
    );
  }

  const clientPath = config.client.path;
  const tokenPath = config.token.path;
  const { clientId, clientSecret } = readOAuthClientCredentials(clientPath);

  const { code, redirectUri } = await withLoopbackServer(async (redirectUri) => {
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [...OAUTH_SCOPES],
    });

    console.error("Opening Google authorization page in your browser…");
    console.error("Requested scopes:");
    for (const scope of OAUTH_SCOPES) {
      console.error(`  - ${scope}`);
    }
    console.error("If the browser does not open, visit this URL:");
    console.error(authUrl);

    try {
      await open(authUrl);
    } catch {
      console.error("Could not open a browser automatically; paste the URL above into a browser.");
    }
  });

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token && !tokens.refresh_token) {
    throw new AppError(
      "Authorization completed but no tokens were returned. Try `npm run auth` again.",
      "AUTH_NO_TOKENS",
    );
  }

  saveTokens(tokenPath, tokens);
  console.error(`Authorization successful. Tokens saved to: ${tokenPath}`);
  console.error(
    "For Vercel: set GOOGLE_OAUTH_TOKEN_JSON to this file's contents (Project → Settings → Environment Variables).",
  );
  console.error("You can now start the local MCP server from Cursor, or deploy the HTTP endpoint.");
}

/**
 * Start a temporary loopback HTTP server, invoke onReady with the redirect URI,
 * then wait for Google's authorization redirect containing `code`.
 */
function withLoopbackServer(
  onReady: (redirectUri: string) => Promise<void>,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let redirectUri = "";
    let settled = false;

    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
        if (requestUrl.pathname !== "/") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Authorization denied. You can close this window.");
          finish(
            new AppError(
              `Google authorization was denied (${error}). Re-run npm run auth and grant the requested scopes.`,
              "AUTH_DENIED",
            ),
          );
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Missing authorization code.");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<html><body><h1>Authorization complete</h1><p>You can close this window and return to the terminal.</p></body></html>",
        );
        finish(undefined, { code, redirectUri });
      } catch (err) {
        finish(err);
      }
    });

    const finish = (err?: unknown, result?: { code: string; redirectUri: string }) => {
      if (settled) return;
      settled = true;
      server.close();
      if (err) reject(err);
      else if (result) resolve(result);
    };

    server.on("error", (err) => finish(err));

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${addr.port}`;
      void onReady(redirectUri).catch((err) => finish(err));
    });
  });
}

authorize().catch((error) => {
  console.error(`Authorization failed: ${toSafeErrorMessage(error)}`);
  process.exitCode = 1;
});
