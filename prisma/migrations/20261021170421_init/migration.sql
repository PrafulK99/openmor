-- CreateEnum
CREATE TYPE "DodoEnvironment" AS ENUM ('test_mode', 'live_mode');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('open', 'used', 'expired');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_payment', 'paid', 'fulfilled', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "CheckoutMode" AS ENUM ('handoff', 'saved_method');

-- CreateEnum
CREATE TYPE "BuyerLinkStatus" AS ENUM ('pending_approval', 'active', 'revoked', 'expired');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "dodoApiKeyEncrypted" TEXT NOT NULL,
    "dodoWebhookSecretEncrypted" TEXT,
    "dodoEnvironment" "DodoEnvironment" NOT NULL DEFAULT 'test_mode',
    "liveModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "networkOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "providerProductId" VARCHAR(128) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "imageUrl" VARCHAR(2048),
    "priceAmount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "agentSellable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "providerData" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "country" CHAR(2) NOT NULL,
    "state" VARCHAR(64),
    "zip" VARCHAR(32),
    "discountCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currency" CHAR(3) NOT NULL,
    "subtotalAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "recurringBreakup" JSONB,
    "isBinding" BOOLEAN NOT NULL DEFAULT true,
    "status" "QuoteStatus" NOT NULL DEFAULT 'open',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "buyerLinkId" TEXT,
    "agentSessionId" TEXT,
    "idempotencyKey" CHAR(64) NOT NULL,
    "buyerEmail" VARCHAR(320) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "checkoutMode" "CheckoutMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "providerCheckoutSessionId" VARCHAR(128),
    "providerPaymentId" VARCHAR(128),
    "checkoutUrl" VARCHAR(2048),
    "fulfillment" JSONB,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLink" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "buyerEmail" VARCHAR(320) NOT NULL,
    "status" "BuyerLinkStatus" NOT NULL DEFAULT 'pending_approval',
    "approvalTokenHash" CHAR(64) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "perOrderCapAmount" INTEGER,
    "totalCapAmount" INTEGER,
    "spentAmount" INTEGER NOT NULL DEFAULT 0,
    "productScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerCustomerId" VARCHAR(128),
    "providerPaymentMethodId" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "clientName" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_slug_key" ON "Merchant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");

-- CreateIndex
CREATE INDEX "Product_agentSellable_active_idx" ON "Product"("agentSellable", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_providerProductId_key" ON "Product"("merchantId", "providerProductId");

-- CreateIndex
CREATE INDEX "Quote_merchantId_createdAt_idx" ON "Quote"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_expiresAt_idx" ON "Quote"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerCheckoutSessionId_key" ON "Order"("providerCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_providerPaymentId_key" ON "Order"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Order_merchantId_createdAt_idx" ON "Order"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_buyerEmail_idx" ON "Order"("buyerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLink_approvalTokenHash_key" ON "BuyerLink"("approvalTokenHash");

-- CreateIndex
CREATE INDEX "BuyerLink_merchantId_buyerEmail_idx" ON "BuyerLink"("merchantId", "buyerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSession_tokenHash_key" ON "AgentSession"("tokenHash");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerLinkId_fkey" FOREIGN KEY ("buyerLinkId") REFERENCES "BuyerLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLink" ADD CONSTRAINT "BuyerLink_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLink" ADD CONSTRAINT "BuyerLink_agentSessionId_fkey" FOREIGN KEY ("agentSessionId") REFERENCES "AgentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
