/**
 * Local Streamable HTTP server for smoke-testing the Vercel handler without deploying.
 * Usage: npm run start:http
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpHttpRequest } from "./mcp-app.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";

const port = Number(process.env.PORT) || 3000;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function toWebRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? `127.0.0.1:${port}`;
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = body;
  }
  return new Request(url, init);
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (req.method === "GET" && url.pathname === "/health") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            ok: true,
            name: SERVER_NAME,
            version: SERVER_VERSION,
          }),
        );
        return;
      }

      if (url.pathname !== "/api/mcp" && url.pathname !== "/mcp") {
        res.statusCode = 404;
        res.end("Not found. MCP endpoint: POST /api/mcp");
        return;
      }

      const body = await readBody(req);
      const webRequest = toWebRequest(req, body);
      const webResponse = await handleMcpHttpRequest(webRequest);
      await writeWebResponse(res, webResponse);
    } catch (error) {
      console.error(
        `[${SERVER_NAME}] local HTTP error:`,
        error instanceof Error ? error.message : "unknown",
      );
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  })();
});

server.listen(port, "0.0.0.0", () => {
  console.error(
    `${SERVER_NAME} MCP HTTP v${SERVER_VERSION} listening on http://127.0.0.1:${port}/api/mcp`,
  );
});
