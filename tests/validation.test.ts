import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractDocumentId,
  isValidEmail,
  normalizeDocContent,
  normalizeEmailBody,
  normalizeEmailList,
  normalizeSubject,
} from "../src/utils/validation.js";
import { AppError } from "../src/utils/errors.js";

describe("email validation", () => {
  it("accepts syntactically valid emails", () => {
    assert.equal(isValidEmail("alex@example.com"), true);
    assert.equal(isValidEmail("  user+tag@domain.co.uk "), true);
  });

  it("rejects invalid emails", () => {
    assert.equal(isValidEmail("not-an-email"), false);
    assert.equal(isValidEmail("@missing-local.com"), false);
    assert.equal(isValidEmail("missing-domain@"), false);
  });

  it("normalizes email lists and trims", () => {
    assert.deepEqual(normalizeEmailList(["  a@b.com ", "c@d.com"], "to"), [
      "a@b.com",
      "c@d.com",
    ]);
  });

  it("rejects invalid addresses in lists", () => {
    assert.throws(
      () => normalizeEmailList(["good@ex.com", "bad"], "to"),
      (err: unknown) => err instanceof AppError && /Invalid email/.test(err.message),
    );
  });

  it("rejects empty subject and body", () => {
    assert.throws(() => normalizeSubject("   "), AppError);
    assert.throws(() => normalizeEmailBody("\n\t  "), AppError);
  });

  it("preserves body newlines when non-empty", () => {
    const body = "Line 1\nLine 2\n";
    assert.equal(normalizeEmailBody(body), body);
  });
});

describe("document ID / URL validation", () => {
  it("accepts a raw document ID", () => {
    assert.equal(extractDocumentId("1AbC_def-123XYZ"), "1AbC_def-123XYZ");
  });

  it("parses a valid Google Docs URL", () => {
    assert.equal(
      extractDocumentId("https://docs.google.com/document/d/1AbC_def-123XYZ/edit"),
      "1AbC_def-123XYZ",
    );
    assert.equal(
      extractDocumentId(
        "https://docs.google.com/document/d/1AbC_def-123XYZ/edit?usp=sharing",
      ),
      "1AbC_def-123XYZ",
    );
  });

  it("rejects unrelated URLs", () => {
    assert.throws(
      () => extractDocumentId("https://drive.google.com/file/d/abc/view"),
      AppError,
    );
    assert.throws(() => extractDocumentId("https://example.com/doc"), AppError);
  });

  it("rejects empty ID and empty content", () => {
    assert.throws(() => extractDocumentId("  "), AppError);
    assert.throws(() => normalizeDocContent("   "), AppError);
  });
});
