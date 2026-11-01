import type { docs_v1 } from "googleapis";
import { AppError, toSafeErrorMessage } from "../utils/errors.js";
import {
  documentUrl,
  extractDocumentId,
  normalizeDocContent,
} from "../utils/validation.js";

export interface AppendDocInput {
  documentIdOrUrl: string;
  content: string;
}

export interface AppendDocResult {
  documentId: string;
  url: string;
  insertedText: string;
}

export type DocsApiClient = {
  get: (params: { documentId: string }) => Promise<{ data: docs_v1.Schema$Document }>;
  batchUpdate: (params: {
    documentId: string;
    requestBody: docs_v1.Schema$BatchUpdateDocumentRequest;
  }) => Promise<unknown>;
};

/**
 * Decide text to insert: optional leading newline if body already has substantive text,
 * and a trailing newline when the content does not already end with one.
 */
export function buildAppendText(content: string, bodyHasSubstantiveText: boolean): string {
  let text = content;
  if (bodyHasSubstantiveText && !text.startsWith("\n")) {
    text = `\n${text}`;
  }
  if (!text.endsWith("\n")) {
    text = `${text}\n`;
  }
  // Empty document: avoid leading blank paragraph from a lone leading newline
  if (!bodyHasSubstantiveText && text.startsWith("\n")) {
    text = text.replace(/^\n+/, "");
    if (!text.endsWith("\n")) {
      text = `${text}\n`;
    }
  }
  return text;
}

/**
 * Detect whether the document body already contains non-whitespace text.
 */
export function documentBodyHasSubstantiveText(doc: docs_v1.Schema$Document): boolean {
  const content = doc.body?.content;
  if (!content || content.length === 0) return false;

  for (const element of content) {
    const paragraph = element.paragraph;
    if (!paragraph?.elements) continue;
    for (const el of paragraph.elements) {
      const text = el.textRun?.content;
      if (text && text.replace(/\s/g, "").length > 0) {
        return true;
      }
    }
  }
  return false;
}

export function buildInsertEndOfBodyRequest(text: string): docs_v1.Schema$Request {
  return {
    insertText: {
      text,
      endOfSegmentLocation: {
        segmentId: "", // empty string = document body
      },
    },
  };
}

export async function appendToDocument(
  client: DocsApiClient,
  input: AppendDocInput,
): Promise<AppendDocResult> {
  const documentId = extractDocumentId(input.documentIdOrUrl);
  const content = normalizeDocContent(input.content);

  let bodyHasText = false;
  try {
    const existing = await client.get({ documentId });
    bodyHasText = documentBodyHasSubstantiveText(existing.data);
  } catch (error) {
    throw new AppError(toSafeErrorMessage(error), "DOCS_GET_FAILED");
  }

  const insertedText = buildAppendText(content, bodyHasText);
  const request = buildInsertEndOfBodyRequest(insertedText);

  // Safety: only insertText with endOfSegmentLocation — never delete/replace
  if (!request.insertText || request.deleteContentRange || request.replaceAllText) {
    throw new AppError("Internal error: refusing non-append Docs mutation.", "DOCS_SAFETY");
  }

  try {
    await client.batchUpdate({
      documentId,
      requestBody: {
        requests: [request],
      },
    });
  } catch (error) {
    throw new AppError(toSafeErrorMessage(error), "DOCS_APPEND_FAILED");
  }

  return {
    documentId,
    url: documentUrl(documentId),
    insertedText,
  };
}

export function createDocsApiClient(docs: docs_v1.Docs): DocsApiClient {
  return {
    get: (params) => docs.documents.get(params),
    batchUpdate: (params) => docs.documents.batchUpdate(params),
  };
}
