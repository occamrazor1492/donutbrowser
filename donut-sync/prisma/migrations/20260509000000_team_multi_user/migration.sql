CREATE TYPE "UserRole" AS ENUM ('admin', 'member');
CREATE TYPE "ProfilePermissionLevel" AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE "BrowserEngine" AS ENUM ('botbrowser', 'wayfern', 'camoufox');

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'member',
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamProfile" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "engine" "BrowserEngine" NOT NULL DEFAULT 'botbrowser',
  "botProfileAssetId" TEXT,
  "syncMode" TEXT NOT NULL DEFAULT 'Regular',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfilePermission" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "ProfilePermissionLevel" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfilePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfileLock" (
  "profileId" TEXT NOT NULL,
  "lockedByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfileLock_pkey" PRIMARY KEY ("profileId")
);

CREATE TABLE "BotProfileAsset" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "s3Key" TEXT NOT NULL,
  "browserMajorVersion" TEXT,
  "platform" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotProfileAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "TeamProfile_teamId_idx" ON "TeamProfile"("teamId");
CREATE INDEX "TeamProfile_ownerUserId_idx" ON "TeamProfile"("ownerUserId");
CREATE UNIQUE INDEX "ProfilePermission_profileId_userId_key" ON "ProfilePermission"("profileId", "userId");
CREATE INDEX "ProfilePermission_userId_idx" ON "ProfilePermission"("userId");
CREATE INDEX "BotProfileAsset_teamId_idx" ON "BotProfileAsset"("teamId");
CREATE INDEX "AuditLog_teamId_createdAt_idx" ON "AuditLog"("teamId", "createdAt");

ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamProfile" ADD CONSTRAINT "TeamProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamProfile" ADD CONSTRAINT "TeamProfile_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamProfile" ADD CONSTRAINT "TeamProfile_botProfileAssetId_fkey" FOREIGN KEY ("botProfileAssetId") REFERENCES "BotProfileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProfilePermission" ADD CONSTRAINT "ProfilePermission_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TeamProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfilePermission" ADD CONSTRAINT "ProfilePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileLock" ADD CONSTRAINT "ProfileLock_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TeamProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileLock" ADD CONSTRAINT "ProfileLock_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotProfileAsset" ADD CONSTRAINT "BotProfileAsset_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotProfileAsset" ADD CONSTRAINT "BotProfileAsset_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
