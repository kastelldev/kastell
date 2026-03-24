import { z } from "zod";
import type { McpResponse } from "../types.js";

// IMPORTANT: Schema is a flat object, NOT wrapped in z.object()
// The SDK wraps it automatically
export const __NAME_CAMEL__Schema = {
  server: z
    .string()
    .optional()
    .describe("Server name or IP. Auto-selected if only one server exists."),
  action: z.enum(["TODO"]).describe("TODO: describe actions"),
};

export async function handle__NAME_PASCAL__(params: {
  server?: string;
  action: string;
}): Promise<McpResponse> {
  // Delegate to core function (NOT direct SSH/provider calls)
  // Example: const result = await someCoreFunction(params);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true }, null, 2),
      },
    ],
  };
}
