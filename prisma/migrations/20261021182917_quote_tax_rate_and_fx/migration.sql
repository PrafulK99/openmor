-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "isConverted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxRateBps" INTEGER;
