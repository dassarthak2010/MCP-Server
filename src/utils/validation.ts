import { AppError } from "./errors.js";

/** Practical RFC 5322-inspired email check (syntactic, not deliverability). */
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const DOCS_URL_RE =
  /^https?:\/\/(?:www\.)?docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function normalizeEmailList(
  values: string[] | undefined,
  fieldName: string,
): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  const normalized: string[] = [];
  const invalid: string[] = [];
  for (const raw of values) {
    const trimmed = String(raw).trim();
    if (!trimmed || !isValidEmail(trimmed)) {
      invalid.push(String(raw));
      continue;
    }
    normalized.push(trimmed);
  }
  if (invalid.length > 0) {
    throw new AppError(
      `Invalid email address(es) in ${fieldName}: ${invalid.join(", ")}`,
      "VALIDATION_EMAIL",
    );
  }
  return normalized;
}

export function requireNonEmptyText(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(
      `Missing or empty ${fieldName}. Provide a non-empty value.`,
      "VALIDATION_EMPTY",
    );
  }
  return value;
}

/**
 * Trim subject surrounding whitespace but reject empty subjects.
 */
export function normalizeSubject(subject: string): string {
  const trimmed = requireNonEmptyText(subject, "subject").trim();
  if (trimmed.length === 0) {
    throw new AppError("Subject cannot be empty or whitespace-only.", "VALIDATION_EMPTY");
  }
  return trimmed;
}

/**
 * Reject whitespace-only bodies; preserve internal newlines and Unicode.
 */
export function normalizeEmailBody(body: string): string {
  return requireNonEmptyText(body, "body");
}

export function normalizeDocContent(content: string): string {
  return requireNonEmptyText(content, "content");
}

/**
 * Accept a raw Google Docs document ID or a full document URL.
 */
export function extractDocumentId(documentIdOrUrl: string): string {
  const raw = requireNonEmptyText(documentIdOrUrl, "document_id_or_url").trim();

  const urlMatch = raw.match(DOCS_URL_RE);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Reject other URLs that are not Docs document links
  if (/^https?:\/\//i.test(raw)) {
    throw new AppError(
      "Invalid Google Docs URL. Expected a link like " +
        "https://docs.google.com/document/d/{documentId}/edit",
      "VALIDATION_DOC_URL",
    );
  }

  // Raw document IDs are typically alphanumeric with _ and -
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) {
    throw new AppError(
      "Invalid Google Docs document ID. Provide a document ID or full Docs URL.",
      "VALIDATION_DOC_ID",
    );
  }

  return raw;
}

export function documentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
