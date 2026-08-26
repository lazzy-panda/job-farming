-- AlterTable
ALTER TABLE "Proxy" ADD COLUMN "cookieSource" TEXT;
ALTER TABLE "Proxy" ADD COLUMN "cookieUpdatedAt" DATETIME;
ALTER TABLE "Proxy" ADD COLUMN "userAgentSource" TEXT;
ALTER TABLE "Proxy" ADD COLUMN "userAgentUpdatedAt" DATETIME;

-- CreateTable
CREATE TABLE "DeletedJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "link" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DeletedJob_link_key" ON "DeletedJob"("link");
