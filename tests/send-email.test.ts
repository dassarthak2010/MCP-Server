import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMimeMessage,
  encodeSubject,
  prepareEmail,
  sendPreparedEmail,
  type GmailMessagesClient,
} from "../src/services/gmail.js";
import { handleSendEmail } from "../src/tools/send-email.js";
import { AppError } from "../src/utils/errors.js";

describe("MIME builder", () => {
  it("builds a valid plain-text MIME message with to/subject/body", () => {
    const mime = buildMimeMessage({
      to: ["alex@example.com"],
      cc: [],
      bcc: [],
      subject: "Project update",
      body: "Hello\nWorld",
    });
    assert.match(mime, /^To: alex@example.com\r\n/);
    assert.match(mime, /Subject: Project update\r\n/);
    assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.ok(mime.includes("\r\n\r\nHello\r\nWorld"));
  });

  it("includes cc and bcc headers when supplied", () => {
    const mime = buildMimeMessage({
      to: ["a@ex.com"],
      cc: ["c@ex.com"],
      bcc: ["b@ex.com"],
      subject: "Hi",
      body: "Body",
    });
    assert.match(mime, /Cc: c@ex.com/);
    assert.match(mime, /Bcc: b@ex.com/);
  });

  it("preserves non-ASCII via encoded subject and utf-8 body", () => {
    const subject = encodeSubject("更新");
    assert.match(subject, /^=\?UTF-8\?B\?/);
    const prepared = prepareEmail({
      to: ["alex@example.com"],
      subject: "更新",
      body: "こんにちは\n世界",
    });
    const decoded = Buffer.from(
      prepared.rawBase64Url.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    assert.ok(decoded.includes("こんにちは"));
    assert.ok(decoded.includes("世界"));
  });
});

describe("prepareEmail validation", () => {
  it("rejects invalid or missing recipients", () => {
    assert.throws(
      () => prepareEmail({ to: [], subject: "S", body: "B" }),
      AppError,
    );
    assert.throws(
      () => prepareEmail({ to: ["nope"], subject: "S", body: "B" }),
      AppError,
    );
  });
});

describe("send_email tool behavior", () => {
  it("confirm_send false returns preview and makes zero Gmail API calls", async () => {
    let calls = 0;
    const mockClient: GmailMessagesClient = {
      send: async () => {
        calls += 1;
        return { data: { id: "should-not-run" } };
      },
    };

    const result = await handleSendEmail(
      {
        to: ["alex@example.com"],
        subject: "Project update",
        body: "Hello",
        confirm_send: false,
      },
      {
        getMessagesClient: async () => mockClient,
        send: async () => {
          calls += 1;
          return { messageId: "x" };
        },
      },
    );

    assert.equal(calls, 0);
    const text = result.content[0]?.text ?? "";
    assert.match(text, /NOT SENT/i);
    assert.match(text, /alex@example.com/);
    assert.match(text, /Project update/);
    assert.equal("isError" in result && result.isError, false);
  });

  it("confirm_send true makes exactly one send request", async () => {
    let calls = 0;
    const mockClient: GmailMessagesClient = {
      send: async (params) => {
        calls += 1;
        assert.equal(params.userId, "me");
        assert.ok(params.requestBody.raw.length > 0);
        return { data: { id: "msg-123" } };
      },
    };

    const result = await handleSendEmail(
      {
        to: ["alex@example.com"],
        subject: "Project update",
        body: "Hello",
        confirm_send: true,
      },
      {
        getMessagesClient: async () => mockClient,
      },
    );

    assert.equal(calls, 1);
    assert.match(result.content[0]?.text ?? "", /msg-123/);
  });

  it("does not automatically retry after an ambiguous send timeout", async () => {
    let calls = 0;
    const mockClient: GmailMessagesClient = {
      send: async () => {
        calls += 1;
        const err = new Error("socket hang up");
        (err as { code?: string }).code = "ETIMEDOUT";
        throw err;
      },
    };

    await assert.rejects(
      () =>
        sendPreparedEmail(mockClient, prepareEmail({
          to: ["alex@example.com"],
          subject: "S",
          body: "B",
        })),
      (err: unknown) =>
        err instanceof AppError &&
        /uncertain|Sent mail|does not automatically retry/i.test(err.message),
    );
    assert.equal(calls, 1);
  });
});
