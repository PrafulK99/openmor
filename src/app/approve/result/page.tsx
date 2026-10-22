// What the buyer sees after pressing Approve or Decline. The code in the URL is only a short
// word like "approved"; it selects fixed text, so it carries nothing sensitive.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { messageFor } from "../messages";

export const metadata: Metadata = {
  title: "Approval · OpenMoR",
  robots: { index: false, follow: false },
};

const box = { padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "36rem", margin: "0 auto" } as const;

async function Result({ searchParams }: { searchParams: Promise<{ r?: string | string[] }> }) {
  const { r } = await searchParams;
  const m = messageFor(Array.isArray(r) ? r[0] : r);
  return (
    <>
      <h1>{m.heading}</h1>
      <p>{m.body}</p>
      {m.retry ? (
        <p>
          <Link href="/approve" prefetch={false}>
            Back to the approval request
          </Link>
        </p>
      ) : null}
    </>
  );
}

export default function ResultPage({ searchParams }: PageProps<"/approve/result">) {
  return (
    <main style={box}>
      <Suspense fallback={<p>One moment…</p>}>
        <Result searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
