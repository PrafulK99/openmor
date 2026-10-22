// Where a buyer reviews and approves an agent's spending permission. Reached by redirect from
// the emailed link, which leaves the token in a cookie (see landing.ts). Rendering this page
// reads only: approving or declining happens in the POST (see actions.ts).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { getServerDeps } from "@/app/server-deps";
import { describeTerms, getApprovalView } from "@/core/buyer-links";
import { decide } from "./actions";
import { APPROVAL_COOKIE } from "./landing";
import { MESSAGES } from "./messages";

export const metadata: Metadata = {
  title: "Approve purchases · OpenMoR",
  robots: { index: false, follow: false },
};

const box = { padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "36rem", margin: "0 auto" } as const;
const button = { padding: "0.6rem 1.2rem", fontSize: "1rem", marginRight: "0.75rem", cursor: "pointer" } as const;

async function Approval() {
  // Live data on every request: never prerendered or cached.
  const token = (await cookies()).get(APPROVAL_COOKIE)?.value;
  const view = token ? await getApprovalView(await getServerDeps(), token) : { kind: "invalid" as const };

  if (view.kind !== "ready") {
    const m = MESSAGES[view.kind];
    return (
      <>
        <h1>{m.heading}</h1>
        <p>{m.body}</p>
      </>
    );
  }
  return (
    <>
      <h1>Let your assistant buy from {view.terms.merchantName}?</h1>
      <p>An AI assistant asked for permission to buy from {view.terms.merchantName} for {view.buyerEmail}. Approve only if that was you.</p>
      <ul>
        {describeTerms(view.terms).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        Purchases are charged to the card you already saved with the seller&apos;s payment provider. OpenMoR never sees your card number.
        Nothing is charged unless you approve.
      </p>
      <form action={decide}>
        <button type="submit" name="decision" value="approve" style={button}>
          Approve
        </button>
        <button type="submit" name="decision" value="decline" style={button}>
          Decline
        </button>
      </form>
    </>
  );
}

export default function ApprovePage() {
  return (
    <main style={box}>
      <Suspense fallback={<p>Loading your approval request…</p>}>
        <Approval />
      </Suspense>
    </main>
  );
}
