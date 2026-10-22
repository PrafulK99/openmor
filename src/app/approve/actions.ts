"use server";
// The Approve and Decline buttons. A server action is a POST, protected by Next's same-origin
// check, and it reads the token from the HttpOnly cookie set by the emailed link. Nothing else
// can change a link's status.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerDeps } from "@/app/server-deps";
import { decideApproval, type DecisionResult } from "@/core/buyer-links";
import { APPROVAL_COOKIE } from "./landing";
import { isFinal } from "./messages";

export async function decide(formData: FormData): Promise<void> {
  const decision = formData.get("decision");
  const jar = await cookies();
  const token = jar.get(APPROVAL_COOKIE)?.value;
  let kind: DecisionResult["kind"] = "invalid";
  if (token && (decision === "approve" || decision === "decline")) {
    kind = (await decideApproval(await getServerDeps(), token, decision)).kind;
  }
  if (isFinal(kind)) jar.delete({ name: APPROVAL_COOKIE, path: "/approve" });
  // redirect() works by throwing: keep it outside any try/catch.
  redirect(`/approve/result?r=${kind}`);
}
