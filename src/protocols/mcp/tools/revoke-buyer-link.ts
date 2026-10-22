import { z } from "zod";
import { revokeBuyerLink } from "@/core/buyer-links";
import { invalid, ok } from "../results";
import { defineTool } from "../tool";
import { buyerLinkOutputSchema, linkOutput } from "./get-buyer-link";

const inputSchema = z.object({
  buyer_link_id: z.string().describe("buyer_link_id from link_buyer."),
  buyer_email: z.string().describe("The buyer's email address the link was created for. It must match."),
});

export const revokeBuyerLinkTool = defineTool({
  name: "revoke_buyer_link",
  title: "Revoke a buyer link",
  description: [
    "Cancel a buyer link so nothing more can be charged with it. Call it when the buyer asks you to stop buying for them, or says they no longer want you to have this permission.",
    "It works on a link that is still waiting for approval as well as an approved one. Purchases that were already paid are not affected. Revoking twice is harmless.",
    "Needs the buyer's email as well as the buyer_link_id.",
    "Never revoke a link on your own initiative, and never invent a buyer_link_id.",
  ].join(" "),
  inputSchema,
  outputSchema: buyerLinkOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async (input, { deps }) => {
    if (!input.buyer_link_id.trim()) invalid("buyer_link_id is required; use the buyer_link_id from link_buyer.");
    const view = await revokeBuyerLink(deps, { buyerLinkId: input.buyer_link_id, buyerEmail: input.buyer_email });
    return ok(linkOutput(view), "Revoked. No further purchases can be charged with this link. Purchases that were already paid are not affected.");
  },
});
