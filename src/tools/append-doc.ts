import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  getAuthorizedClient,
  getDocsClient,
} from "../auth/google-auth.js";
import {
  appendToDocument,
  createDocsApiClient,
} from "../services/docs.js";
import { toolErrorResult, toolTextResult } from "../utils/errors.js";

export const appendDocInputSchema = z.object({
  document_id_or_url: z
    .string()
    .describe(
      "Google Docs document ID or full URL (https://docs.google.com/document/d/{id}/...). Do not infer from a title.",
    ),
  content: z
    .string()
    .describe(
      "Plain text to append at the end of the document. Line breaks and Unicode are preserved.",
    ),
});

export const APPEND_DOC_DESCRIPTION =
  "Append plain text to the end of an existing Google Doc. " +
  "Requires a document ID or full Docs URL — never infer a document from a title. " +
  "Only appends; never clears, overwrites, truncates, deletes content, creates a new document, " +
  "or changes sharing permissions.";

export async function handleAppendDoc(
  args: z.infer<typeof appendDocInputSchema>,
  deps?: {
    append?: typeof appendToDocument;
    getDocsApi?: () => Promise<ReturnType<typeof createDocsApiClient>>;
  },
) {
  const append = deps?.append ?? appendToDocument;
  const getApi =
    deps?.getDocsApi ??
    (async () => {
      const auth = await getAuthorizedClient();
      return createDocsApiClient(getDocsClient(auth));
    });

  const client = await getApi();
  const result = await append(client, {
    documentIdOrUrl: args.document_id_or_url,
    content: args.content,
  });

  return toolTextResult(
    `Appended text to Google Doc.\nDocument ID: ${result.documentId}\nLink: ${result.url}`,
  );
}

export function registerAppendDocTool(server: McpServer): void {
  server.registerTool(
    "append_to_google_doc",
    {
      description: APPEND_DOC_DESCRIPTION,
      inputSchema: appendDocInputSchema,
    },
    async (args) => {
      try {
        return await handleAppendDoc(args);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
