-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Proxy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "username" TEXT,
    "password" TEXT,
    "userAgent" TEXT,
    "userAgentSource" TEXT,
    "userAgentUpdatedAt" DATETIME,
    "cookieHeader" TEXT,
    "cookieSource" TEXT,
    "cookieUpdatedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME,
    "lastStatus" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Proxy" ("active", "cookieHeader", "cookieSource", "cookieUpdatedAt", "createdAt", "host", "id", "lastCheckedAt", "lastStatus", "lastUsedAt", "password", "port", "updatedAt", "userAgent", "userAgentSource", "userAgentUpdatedAt", "username") SELECT "active", "cookieHeader", "cookieSource", "cookieUpdatedAt", "createdAt", "host", "id", "lastCheckedAt", "lastStatus", "lastUsedAt", "password", "port", "updatedAt", "userAgent", "userAgentSource", "userAgentUpdatedAt", "username" FROM "Proxy";
DROP TABLE "Proxy";
ALTER TABLE "new_Proxy" RENAME TO "Proxy";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
