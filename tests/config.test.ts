import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { loadConfig, isEphemeralTokenStore } from "../src/utils/config.js";
import { AppError } from "../src/utils/errors.js";
import { unauthorizedMcpResponse } from "../src/http/bearer-auth.js";

const ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_PATH",
  "GOOGLE_OAUTH_TOKEN_PATH",
  "GOOGLE_OAUTH_CLIENT_JSON",
  "GOOGLE_OAUTH_TOKEN_JSON",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MCP_AUTH_TOKEN",
  "REQUIRE_MCP_AUTH",
  "VERCEL",
] as const;

describe("loadConfig env modes", () => {
  const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("loads client + token from JSON env vars (Vercel Path A)", () => {
    process.env.GOOGLE_OAUTH_CLIENT_JSON = JSON.stringify({
      installed: {
        client_id: "cid",
        client_secret: "csecret",
        redirect_uris: ["http://localhost"],
      },
    });
    process.env.GOOGLE_OAUTH_TOKEN_JSON = JSON.stringify({
      refresh_token: "rt",
      access_token: "at",
    });

    const cfg = loadConfig({ requireClientFile: false });
    assert.equal(cfg.client.kind, "json");
    assert.equal(cfg.token.kind, "json");
    assert.equal(isEphemeralTokenStore(cfg), true);
  });

  it("loads client id/secret parts + token JSON", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    process.env.GOOGLE_OAUTH_TOKEN_JSON = "{}";

    const cfg = loadConfig({ requireClientFile: false });
    assert.equal(cfg.client.kind, "parts");
    if (cfg.client.kind === "parts") {
      assert.equal(cfg.client.clientId, "cid");
    }
  });

  it("throws when credentials are missing", () => {
    assert.throws(() => loadConfig({ requireClientFile: false }), (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "CONFIG_MISSING");
      return true;
    });
  });
});

describe("bearer auth gate", () => {
  const originalToken = process.env.MCP_AUTH_TOKEN;
  const originalRequire = process.env.REQUIRE_MCP_AUTH;
  const originalVercel = process.env.VERCEL;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.MCP_AUTH_TOKEN;
    else process.env.MCP_AUTH_TOKEN = originalToken;
    if (originalRequire === undefined) delete process.env.REQUIRE_MCP_AUTH;
    else process.env.REQUIRE_MCP_AUTH = originalRequire;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("rejects missing bearer when MCP_AUTH_TOKEN is set", async () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";
    const res = unauthorizedMcpResponse(new Request("http://localhost/api/mcp"));
    assert.ok(res);
    assert.equal(res.status, 401);
  });

  it("accepts matching bearer token", () => {
    process.env.MCP_AUTH_TOKEN = "secret-token";
    const res = unauthorizedMcpResponse(
      new Request("http://localhost/api/mcp", {
        headers: { Authorization: "Bearer secret-token" },
      }),
    );
    assert.equal(res, undefined);
  });
});
