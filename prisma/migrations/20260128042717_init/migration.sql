-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broadcasterId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Channel" ("broadcasterId", "createdAt", "displayName", "id", "login", "updatedAt") SELECT "broadcasterId", "createdAt", "displayName", "id", "login", "updatedAt" FROM "Channel";
DROP TABLE "Channel";
ALTER TABLE "new_Channel" RENAME TO "Channel";
CREATE UNIQUE INDEX "Channel_broadcasterId_key" ON "Channel"("broadcasterId");
CREATE TABLE "new_Token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "broadcasterId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "scopes" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Token" ("accessToken", "broadcasterId", "createdAt", "expiresAt", "id", "refreshToken", "scopes", "tokenType", "updatedAt") SELECT "accessToken", "broadcasterId", "createdAt", "expiresAt", "id", "refreshToken", "scopes", "tokenType", "updatedAt" FROM "Token";
DROP TABLE "Token";
ALTER TABLE "new_Token" RENAME TO "Token";
CREATE UNIQUE INDEX "Token_broadcasterId_key" ON "Token"("broadcasterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineIndex
DROP INDEX "Clip_broadcasterId_index";
CREATE INDEX "Clip_broadcasterId_idx" ON "Clip"("broadcasterId");
