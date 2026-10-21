-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "chargedCurrency" CHAR(3),
ADD COLUMN     "chargedTaxAmount" INTEGER,
ADD COLUMN     "chargedTotalAmount" INTEGER;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "webhookId" VARCHAR(128) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "orderId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_orderId_idx" ON "WebhookEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_merchantId_webhookId_key" ON "WebhookEvent"("merchantId", "webhookId");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keep the new table away from Supabase's Data API, like every other table
-- (see 20261021171405_enable_rls_revoke_api_roles). RLS with no policies denies
-- all rows to other roles; the REVOKE also covers TRUNCATE.
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."WebhookEvent" FROM %I', api_role);
    END IF;
  END LOOP;
END
$$;
