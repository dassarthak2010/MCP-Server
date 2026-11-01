import type { gmail_v1 } from "googleapis";
import { AppError, isTimeoutLike, toSafeErrorMessage } from "../utils/errors.js";
import {
  normalizeEmailBody,
  normalizeEmailList,
  normalizeSubject,
} from "../utils/validation.js";

export interface SendEmailInput {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
}

export interface PreparedEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  rawMime: string;
  rawBase64Url: string;
}

export interface SendEmailResult {
  messageId: string;
}

export type GmailMessagesClient = {
  send: (params: {
    userId: string;
    requestBody: { raw: string };
  }) => Promise<{ data: { id?: string | null } }>;
};

/**
 * Validate and normalize email fields; build MIME + Base64 URL-safe raw payload.
 * Does not call Gmail.
 */
export function prepareEmail(input: SendEmailInput): PreparedEmail {
  const to = normalizeEmailList(input.to, "to");
  if (to.length === 0) {
    throw new AppError(
      "Missing recipient. Provide at least one address in `to`.",
      "VALIDATION_EMPTY",
    );
  }
  const cc = normalizeEmailList(input.cc, "cc");
  const bcc = normalizeEmailList(input.bcc, "bcc");
  const subject = normalizeSubject(input.subject);
  const body = normalizeEmailBody(input.body);

  const rawMime = buildMimeMessage({ to, cc, bcc, subject, body });
  const rawBase64Url = Buffer.from(rawMime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { to, cc, bcc, subject, body, rawMime, rawBase64Url };
}

export function buildMimeMessage(parts: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}): string {
  const headers: string[] = [
    `To: ${parts.to.join(", ")}`,
    `Subject: ${encodeSubject(parts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (parts.cc.length > 0) {
    headers.push(`Cc: ${parts.cc.join(", ")}`);
  }
  if (parts.bcc.length > 0) {
    headers.push(`Bcc: ${parts.bcc.join(", ")}`);
  }

  // CRLF line endings for MIME; preserve body newlines by normalizing to \r\n
  const body = parts.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/**
 * Encode subject for UTF-8 when non-ASCII characters are present (RFC 2047).
 */
export function encodeSubject(subject: string): string {
  if (/^[\x20-\x7E]*$/.test(subject)) {
    return subject;
  }
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Send exactly once. Does not retry on ambiguous timeouts.
 */
export async function sendPreparedEmail(
  gmailMessages: GmailMessagesClient,
  prepared: PreparedEmail,
): Promise<SendEmailResult> {
  try {
    const response = await gmailMessages.send({
      userId: "me",
      requestBody: { raw: prepared.rawBase64Url },
    });
    const messageId = response.data.id;
    if (!messageId) {
      throw new AppError(
        "Gmail did not return a message ID. The send result is uncertain — check Sent mail before retrying.",
        "GMAIL_NO_ID",
      );
    }
    return { messageId };
  } catch (error) {
    if (isTimeoutLike(error)) {
      throw new AppError(
        "Network timeout while sending email. The result may be uncertain. " +
          "Check Gmail Sent mail before trying again to avoid duplicate emails. " +
          "This server does not automatically retry sends after an ambiguous timeout.",
        "GMAIL_TIMEOUT",
      );
    }
    throw new AppError(toSafeErrorMessage(error), "GMAIL_SEND_FAILED");
  }
}

export function createGmailMessagesClient(gmail: gmail_v1.Gmail): GmailMessagesClient {
  return {
    send: (params) => gmail.users.messages.send(params),
  };
}

export function formatEmailPreview(prepared: PreparedEmail): string {
  const lines = [
    "Email preview (NOT SENT). confirm_send was false.",
    `To: ${prepared.to.join(", ")}`,
  ];
  if (prepared.cc.length > 0) lines.push(`Cc: ${prepared.cc.join(", ")}`);
  if (prepared.bcc.length > 0) lines.push(`Bcc: ${prepared.bcc.join(", ")}`);
  lines.push(`Subject: ${prepared.subject}`);
  lines.push("");
  lines.push(prepared.body);
  lines.push("");
  lines.push(
    "Nothing was sent. To send this email, call send_email again with the same fields and confirm_send: true after the user explicitly approves.",
  );
  return lines.join("\n");
}
