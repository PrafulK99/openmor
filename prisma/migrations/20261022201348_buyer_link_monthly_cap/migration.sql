-- BuyerLink caps are per calendar month (UTC). This month's spend is computed from the
-- link's orders, so the stored running total and the lifetime cap go away.

-- AlterTable: add the new columns as nullable first so existing rows can be filled in.
ALTER TABLE "BuyerLink" ADD COLUMN     "approvalExpiresAt" TIMESTAMP(3),
ADD COLUMN     "monthlyCapAmount" INTEGER;

-- Backfill any existing links, which cannot be in use yet: their emailed approval link has
-- lapsed (30 minutes after creation), and a monthly cap of 0 means they can never spend.
UPDATE "BuyerLink"
SET "approvalExpiresAt" = "createdAt" + interval '30 minutes',
    "monthlyCapAmount" = 0;

ALTER TABLE "BuyerLink" ALTER COLUMN "approvalExpiresAt" SET NOT NULL,
ALTER COLUMN "monthlyCapAmount" SET NOT NULL;

-- Spend is computed, never stored.
ALTER TABLE "BuyerLink" DROP COLUMN "totalCapAmount",
DROP COLUMN "spentAmount";

-- CreateIndex: this month's spend for a link is a range scan on its orders.
CREATE INDEX "Order_buyerLinkId_createdAt_idx" ON "Order"("buyerLinkId", "createdAt");
