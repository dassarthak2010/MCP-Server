import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendToDocument,
  buildAppendText,
  buildInsertEndOfBodyRequest,
  documentBodyHasSubstantiveText,
  type DocsApiClient,
} from "../src/services/docs.js";
import { handleAppendDoc } from "../src/tools/append-doc.js";
import { AppError } from "../src/utils/errors.js";
import { extractDocumentId } from "../src/utils/validation.js";

describe("document parsing", () => {
  it("accepts raw ID and valid URL", () => {
    assert.equal(extractDocumentId("docId_123"), "docId_123");
    assert.equal(
      extractDocumentId("https://docs.google.com/document/d/docId_123/edit"),
      "docId_123",
    );
  });

  it("rejects unrelated URL and empty ID", () => {
    assert.throws(() => extractDocumentId("https://example.com/x"), AppError);
    assert.throws(() => extractDocumentId(""), AppError);
  });
});

describe("newline / insert helpers", () => {
  it("detects empty vs non-empty document bodies", () => {
    assert.equal(documentBodyHasSubstantiveText({ body: { content: [] } }), false);
    assert.equal(
      documentBodyHasSubstantiveText({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: "\n" } }],
              },
            },
          ],
        },
      }),
      false,
    );
    assert.equal(
      documentBodyHasSubstantiveText({
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: "Hello" } }],
              },
            },
          ],
        },
      }),
      true,
    );
  });

  it("uses insertText with endOfSegmentLocation", () => {
    const req = buildInsertEndOfBodyRequest("notes\n");
    assert.ok(req.insertText);
    assert.equal(req.insertText?.text, "notes\n");
    assert.deepEqual(req.insertText?.endOfSegmentLocation, { segmentId: "" });
    assert.equal(req.deleteContentRange, undefined);
    assert.equal(req.replaceAllText, undefined);
  });

  it("newline behavior for empty and non-empty documents", () => {
    assert.equal(buildAppendText("Hello", false), "Hello\n");
    assert.equal(buildAppendText("Hello", true), "\nHello\n");
    assert.equal(buildAppendText("Hello\n", true), "\nHello\n");
  });
});

describe("append_to_google_doc", () => {
  it("rejects empty content", async () => {
    const client: DocsApiClient = {
      get: async () => ({ data: { body: { content: [] } } }),
      batchUpdate: async () => ({}),
    };
    await assert.rejects(
      () => appendToDocument(client, { documentIdOrUrl: "abc", content: "  " }),
      AppError,
    );
  });

  it("appends via batchUpdate without delete/replace and returns link", async () => {
    let batchCalls = 0;
    const client: DocsApiClient = {
      get: async () => ({
        data: {
          body: {
            content: [
              {
                paragraph: {
                  elements: [{ textRun: { content: "Existing\n" } }],
                },
              },
            ],
          },
        },
      }),
      batchUpdate: async (params) => {
        batchCalls += 1;
        assert.equal(params.documentId, "doc123");
        const requests = params.requestBody.requests ?? [];
        assert.equal(requests.length, 1);
        const insert = requests[0]?.insertText;
        assert.ok(insert);
        assert.deepEqual(insert?.endOfSegmentLocation, { segmentId: "" });
        assert.equal(requests[0]?.deleteContentRange, undefined);
        assert.equal(requests[0]?.replaceAllText, undefined);
        return {};
      },
    };

    const result = await appendToDocument(client, {
      documentIdOrUrl: "https://docs.google.com/document/d/doc123/edit",
      content: "Meeting notes",
    });

    assert.equal(batchCalls, 1);
    assert.equal(result.documentId, "doc123");
    assert.equal(result.url, "https://docs.google.com/document/d/doc123/edit");
  });

  it("returns API errors without claiming success", async () => {
    const client: DocsApiClient = {
      get: async () => {
        const err = new Error("Not Found");
        (err as { code?: number }).code = 404;
        throw err;
      },
      batchUpdate: async () => ({}),
    };

    await assert.rejects(
      () =>
        handleAppendDoc(
          { document_id_or_url: "missing", content: "Hi" },
          { getDocsApi: async () => client },
        ),
      AppError,
    );
  });

  it("tool wrapper surfaces errors without false success", async () => {
    const client: DocsApiClient = {
      get: async () => ({ data: { body: { content: [] } } }),
      batchUpdate: async () => {
        throw Object.assign(new Error("quota"), { code: 429 });
      },
    };

    await assert.rejects(
      () =>
        handleAppendDoc(
          { document_id_or_url: "doc1", content: "x" },
          { getDocsApi: async () => client },
        ),
      (err: unknown) => err instanceof AppError,
    );
  });
});
