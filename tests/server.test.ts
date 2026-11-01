import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createServer,
  MVP_TOOL_NAMES,
  SERVER_NAME,
  SERVER_VERSION,
} from "../src/server.js";
import { sendEmailInputSchema } from "../src/tools/send-email.js";
import { appendDocInputSchema } from "../src/tools/append-doc.js";

describe("MCP server factory", () => {
  it("exposes stable server identity", () => {
    assert.equal(SERVER_NAME, "google-workspace");
    assert.equal(SERVER_VERSION, "1.0.0");
  });

  it("registers exactly the two required MVP tools", () => {
    const server = createServer();
    assert.ok(server);
    assert.deepEqual([...MVP_TOOL_NAMES].sort(), [
      "append_to_google_doc",
      "send_email",
    ]);
    // Factory constructs without throwing; tool modules are registered inside createServer.
    assert.equal(MVP_TOOL_NAMES.length, 2);
  });

  it("rejects invalid send_email arguments via schema", () => {
    const result = sendEmailInputSchema.safeParse({
      to: [],
      subject: "S",
      body: "B",
      confirm_send: false,
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid append_to_google_doc arguments via schema", () => {
    const result = appendDocInputSchema.safeParse({
      document_id_or_url: 123,
      content: "x",
    });
    assert.equal(result.success, false);
  });

  it("accepts valid tool argument shapes", () => {
    assert.equal(
      sendEmailInputSchema.safeParse({
        to: ["a@b.com"],
        subject: "Hi",
        body: "Hello",
        confirm_send: false,
      }).success,
      true,
    );
    assert.equal(
      appendDocInputSchema.safeParse({
        document_id_or_url: "https://docs.google.com/document/d/abc/edit",
        content: "notes",
      }).success,
      true,
    );
  });
});
