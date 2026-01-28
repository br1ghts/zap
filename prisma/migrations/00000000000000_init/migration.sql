BEGIN TRANSACTION;

CREATE TABLE "Channel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "broadcasterId" TEXT NOT NULL UNIQUE,
  "login" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Token" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "broadcasterId" TEXT NOT NULL UNIQUE,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "scopes" TEXT NOT NULL,
  "tokenType" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("broadcasterId") REFERENCES "Channel"("broadcasterId") ON DELETE CASCADE
);

CREATE TABLE "Clip" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "broadcasterId" TEXT NOT NULL,
  "clipId" TEXT,
  "url" TEXT,
  "requestedBy" TEXT NOT NULL,
  "requestedById" TEXT,
  "note" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Clip_broadcasterId_index" ON "Clip" ("broadcasterId");

COMMIT;
