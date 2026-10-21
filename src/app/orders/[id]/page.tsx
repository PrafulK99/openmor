// Where Dodo's checkout sends the buyer back (return_url). Shows payment status only.
import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getServerDeps } from "@/app/server-deps";
import { getOrder } from "@/core/orders";
import { orderPageModel } from "./status";

export const metadata: Metadata = {
  title: "Order status · OpenMoR",
  robots: { index: false, follow: false },
};

const box = { padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "36rem", margin: "0 auto" } as const;

async function OrderStatus({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Live data on every request: never prerendered or cached.
  await connection();
  const order = await getOrder(await getServerDeps(), id);
  if (!order) notFound();
  const m = orderPageModel(order);
  return (
    <>
      <h1>{m.heading}</h1>
      <p>
        {m.productName} · {m.amount}
      </p>
      <p>{m.detail}</p>
    </>
  );
}

export default function OrderPage({ params }: PageProps<"/orders/[id]">) {
  return (
    <main style={box}>
      <Suspense fallback={<p>Checking your order…</p>}>
        <OrderStatus params={params} />
      </Suspense>
    </main>
  );
}
