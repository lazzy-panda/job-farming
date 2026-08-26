-- AlterTable
ALTER TABLE "Proxy" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "Proxy" ADD COLUMN "cookieHeader" TEXT;
ALTER TABLE "Proxy" ADD COLUMN "lastUsedAt" DATETIME;
