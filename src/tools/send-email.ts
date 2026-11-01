import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  getAuthorizedClient,
  getGmailClient,
} from "../auth/google-auth.js";
import {
  createGmailMessagesClient,
  formatEmailPreview,
  prepareEmail,
  sendPreparedEmail,
} from "../services/gmail.js";
import { toolErrorResult, toolTextResult } from "../utils/errors.js";

export const sendEmailInputSchema = z.object({
  to: z
    .array(z.string())
    .min(1)
    .describe("One or more primary recipient email addresses."),
  subject: z.string().describe("Email subject line. Must not be empty."),
  body: z
    .string()
    .describe("Plain-text email body. Line breaks are preserved."),
  cc: z
    .array(z.string())
    .optional()
    .describe("Optional carbon-copy recipient email addresses."),
  bcc: z
    .array(z.string())
    .optional()
    .describe("Optional blind-carbon-copy recipient email addresses."),
  confirm_send: z
    .boolean()
    .describe(
      "Must be true to actually send. When false, returns a preview and does not call Gmail send.",
    ),
});

export const SEND_EMAIL_DESCRIPTION =
  "Send a plain-text email from the authorized Gmail account. " +
  "Use this tool ONLY when the user has explicitly asked to send an email. " +
  "Always present the final recipient list, subject, and body to the user and obtain their explicit approval " +
  "before calling with confirm_send: true. " +
  "First call with confirm_send: false to preview; a preview never sends. " +
  "Do not invent default recipients, subjects, or bodies.";

/**
 * Core handler used by the MCP tool and unit tests.
 */
export async function handleSendEmail(
  args: z.infer<typeof sendEmailInputSchema>,
  deps?: {
    send?: typeof sendPreparedEmail;
    getMessagesClient?: () => Promise<ReturnType<typeof createGmailMessagesClient>>;
  },
) {
  const prepared = prepareEmail({
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc,
    bcc: args.bcc,
  });

  if (!args.confirm_send) {
    return toolTextResult(formatEmailPreview(prepared));
  }

  const getClient =
    deps?.getMessagesClient ??
    (async () => {
      const auth = await getAuthorizedClient();
      return createGmailMessagesClient(getGmailClient(auth));
    });

  const send = deps?.send ?? sendPreparedEmail;
  const messages = await getClient();
  const result = await send(messages, prepared);

  return toolTextResult(
    `Email sent successfully.\nTo: ${prepared.to.join(", ")}\nSubject: ${prepared.subject}\nGmail message ID: ${result.messageId}`,
  );
}

export function registerSendEmailTool(server: McpServer): void {
  server.registerTool(
    "send_email",
    {
      description: SEND_EMAIL_DESCRIPTION,
      inputSchema: sendEmailInputSchema,
    },
    async (args) => {
      try {
        return await handleSendEmail(args);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
