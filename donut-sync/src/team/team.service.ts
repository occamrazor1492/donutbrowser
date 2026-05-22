import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BotProfileAsset,
  BrowserEngine,
  Prisma,
  ProfilePermissionLevel,
  UserRole,
} from "@prisma/client";
import { hashPassword } from "../auth/password.js";
import type { UserContext } from "../auth/user-context.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";

const WRITE_PERMISSIONS = new Set<ProfilePermissionLevel>([
  ProfilePermissionLevel.owner,
  ProfilePermissionLevel.editor,
]);

@Injectable()
export class TeamService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.bucket = this.config.get<string>("S3_BUCKET") || "donut-sync";
    this.s3Client = new S3Client({
      endpoint:
        this.config.get<string>("S3_ENDPOINT") || "http://localhost:8987",
      region: this.config.get<string>("S3_REGION") || "us-east-1",
      credentials: {
        accessKeyId:
          this.config.get<string>("S3_ACCESS_KEY_ID") || "minioadmin",
        secretAccessKey:
          this.config.get<string>("S3_SECRET_ACCESS_KEY") || "minioadmin",
      },
      forcePathStyle:
        this.config.get<string>("S3_FORCE_PATH_STYLE") !== "false",
    });
  }

  isEnabled(): boolean {
    return this.config.get<string>("MULTI_USER_ENABLED") === "true";
  }

  requireTeamContext(ctx: UserContext): asserts ctx is UserContext & {
    userId: string;
    teamId: string;
    role: "admin" | "member";
  } {
    if (ctx.mode !== "team" || !ctx.userId || !ctx.teamId || !ctx.role) {
      throw new ForbiddenException("Team authentication required");
    }
  }

  async createUser(
    ctx: UserContext,
    input: { email: string; password: string; role?: "admin" | "member" },
  ) {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    const user = await this.prisma.user.create({
      data: {
        teamId: ctx.teamId,
        email: input.email,
        passwordHash: hashPassword(input.password),
        role: input.role === "admin" ? UserRole.admin : UserRole.member,
      },
      select: this.userSelect(),
    });
    await this.audit(ctx, "user.create", "user", user.id, {
      email: user.email,
      role: user.role,
    });
    return user;
  }

  async listUsers(ctx: UserContext) {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    return this.prisma.user.findMany({
      where: { teamId: ctx.teamId },
      orderBy: { createdAt: "desc" },
      select: this.userSelect(),
    });
  }

  async updateUser(
    ctx: UserContext,
    userId: string,
    input: { password?: string; role?: "admin" | "member"; disabled?: boolean },
  ) {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    const data: {
      passwordHash?: string;
      role?: UserRole;
      disabledAt?: Date | null;
    } = {};
    if (input.password) data.passwordHash = hashPassword(input.password);
    if (input.role) {
      data.role = input.role === "admin" ? UserRole.admin : UserRole.member;
    }
    if (typeof input.disabled === "boolean") {
      data.disabledAt = input.disabled ? new Date() : null;
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!existing || existing.teamId !== ctx.teamId) {
      throw new NotFoundException("User not found");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: this.userSelect(),
    });
    await this.audit(ctx, "user.update", "user", user.id, {
      role: user.role,
      disabledAt: user.disabledAt,
    });
    if (input.disabled === true && !existing.disabledAt) {
      await this.audit(ctx, "user.disable", "user", user.id, {
        email: user.email,
      });
    } else if (input.disabled === false && existing.disabledAt) {
      await this.audit(ctx, "user.enable", "user", user.id, {
        email: user.email,
      });
    }
    return user;
  }

  async listProfiles(ctx: UserContext) {
    this.requireTeamContext(ctx);
    const where =
      ctx.role === "admin"
        ? { teamId: ctx.teamId, deletedAt: null }
        : {
            teamId: ctx.teamId,
            deletedAt: null,
            permissions: { some: { userId: ctx.userId } },
          };

    return this.prisma.teamProfile.findMany({
      where,
      include: {
        permissions: { include: { user: { select: this.userSelect() } } },
        botProfileAsset: true,
        lock: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getProfile(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    await this.assertProfileReadable(ctx, profileId);
    return this.prisma.teamProfile.findUniqueOrThrow({
      where: { id: profileId },
      include: {
        permissions: { include: { user: { select: this.userSelect() } } },
        botProfileAsset: true,
        lock: true,
      },
    });
  }

  async createProfile(
    ctx: UserContext,
    input: {
      id?: string;
      name: string;
      engine?: "botbrowser" | "wayfern" | "cloak" | "camoufox";
      botProfileAssetId?: string | null;
      syncMode?: string;
    },
  ) {
    this.requireTeamContext(ctx);
    if (input.botProfileAssetId) {
      await this.assertBotProfileAssetReadable(ctx, input.botProfileAssetId);
    }
    const profile = await this.prisma.teamProfile.create({
      data: {
        id: input.id,
        teamId: ctx.teamId,
        ownerUserId: ctx.userId,
        name: input.name,
        engine: this.toEngine(input.engine),
        botProfileAssetId: input.botProfileAssetId || null,
        syncMode: input.syncMode || "Regular",
        permissions: {
          create: {
            userId: ctx.userId,
            permission: ProfilePermissionLevel.owner,
          },
        },
      },
      include: { permissions: true, botProfileAsset: true, lock: true },
    });
    await this.audit(ctx, "team_profile.create", "profile", profile.id, {
      engine: profile.engine,
      botProfileAssetId: profile.botProfileAssetId,
    });
    return profile;
  }

  async updateProfile(
    ctx: UserContext,
    profileId: string,
    input: {
      name?: string;
      engine?: "botbrowser" | "wayfern" | "cloak" | "camoufox";
      botProfileAssetId?: string | null;
      syncMode?: string;
    },
  ) {
    this.requireTeamContext(ctx);
    await this.assertProfileWritable(ctx, profileId, false);
    if (input.botProfileAssetId) {
      await this.assertBotProfileAssetReadable(ctx, input.botProfileAssetId);
    }
    const profile = await this.prisma.teamProfile.update({
      where: { id: profileId },
      data: {
        name: input.name,
        engine: input.engine ? this.toEngine(input.engine) : undefined,
        botProfileAssetId:
          input.botProfileAssetId === undefined
            ? undefined
            : input.botProfileAssetId,
        syncMode: input.syncMode,
      },
      include: { permissions: true, botProfileAsset: true, lock: true },
    });
    await this.audit(ctx, "team_profile.update", "profile", profile.id, input);
    return profile;
  }

  async deleteProfile(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    await this.assertProfileWritable(ctx, profileId, false);
    const profile = await this.prisma.teamProfile.update({
      where: { id: profileId },
      data: { deletedAt: new Date() },
    });
    await this.audit(ctx, "team_profile.delete", "profile", profile.id);
    return { deleted: true };
  }

  async setProfilePermission(
    ctx: UserContext,
    profileId: string,
    userId: string,
    permission: "owner" | "editor" | "viewer",
  ) {
    this.requireTeamContext(ctx);
    await this.assertProfileWritable(ctx, profileId, false);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.teamId !== ctx.teamId) {
      throw new NotFoundException("User not found");
    }
    const updated = await this.prisma.profilePermission.upsert({
      where: { profileId_userId: { profileId, userId } },
      create: {
        profileId,
        userId,
        permission: this.toPermission(permission),
      },
      update: { permission: this.toPermission(permission) },
    });
    await this.audit(ctx, "permission.set", "profile", profileId, {
      userId,
      permission,
    });
    return updated;
  }

  async deleteProfilePermission(
    ctx: UserContext,
    profileId: string,
    userId: string,
  ) {
    this.requireTeamContext(ctx);
    await this.assertProfileWritable(ctx, profileId, false);
    await this.prisma.profilePermission.delete({
      where: { profileId_userId: { profileId, userId } },
    });
    await this.audit(ctx, "permission.delete", "profile", profileId, {
      userId,
    });
    return { deleted: true };
  }

  async uploadBotProfileAsset(
    ctx: UserContext,
    input: {
      name: string;
      contentBase64: string;
      browserMajorVersion?: string;
      platform?: string;
    },
  ): Promise<BotProfileAsset> {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    const assetId = randomUUID();
    const key = `teams/${ctx.teamId}/bot_profiles/${assetId}.enc`;
    const body = Buffer.from(input.contentBase64, "base64");
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
      }),
    );

    const asset = await this.prisma.botProfileAsset.create({
      data: {
        id: assetId,
        teamId: ctx.teamId,
        name: input.name,
        s3Key: key,
        browserMajorVersion: input.browserMajorVersion,
        platform: input.platform,
        createdByUserId: ctx.userId,
      },
    });
    await this.audit(ctx, "bot_profile.create", "bot_profile", asset.id, {
      name: asset.name,
      s3Key: key,
    });
    return asset;
  }

  async listBotProfileAssets(ctx: UserContext) {
    this.requireTeamContext(ctx);
    return this.prisma.botProfileAsset.findMany({
      where: { teamId: ctx.teamId },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteBotProfileAsset(ctx: UserContext, assetId: string) {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    const asset = await this.prisma.botProfileAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset || asset.teamId !== ctx.teamId) {
      throw new NotFoundException("Bot profile asset not found");
    }
    const referenceCount = await this.prisma.teamProfile.count({
      where: {
        teamId: ctx.teamId,
        botProfileAssetId: assetId,
        deletedAt: null,
      },
    });
    if (referenceCount > 0) {
      throw new ConflictException(
        "Bot profile asset is still used by team profiles",
      );
    }
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: asset.s3Key }),
    );
    await this.prisma.botProfileAsset.delete({ where: { id: assetId } });
    await this.audit(ctx, "bot_profile.delete", "bot_profile", assetId);
    return { deleted: true };
  }

  async acquireLock(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    await this.ensureProfileForSync(ctx, profileId);
    await this.assertProfileWritable(ctx, profileId, false);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.lockTtlMs());
    const existing = await this.prisma.profileLock.findUnique({
      where: { profileId },
    });
    if (
      existing &&
      existing.lockedByUserId !== ctx.userId &&
      existing.expiresAt > now
    ) {
      throw new ConflictException("Profile is already locked");
    }

    const lock = await this.prisma.profileLock.upsert({
      where: { profileId },
      create: {
        profileId,
        lockedByUserId: ctx.userId,
        expiresAt,
        heartbeatAt: now,
      },
      update: {
        lockedByUserId: ctx.userId,
        expiresAt,
        heartbeatAt: now,
      },
    });
    await this.audit(ctx, "lock.acquire", "profile", profileId, {
      expiresAt,
    });
    return lock;
  }

  async heartbeatLock(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    const now = new Date();
    const lock = await this.prisma.profileLock.findUnique({
      where: { profileId },
    });
    if (!lock || lock.lockedByUserId !== ctx.userId) {
      throw new ForbiddenException("Current user does not hold the lock");
    }
    const updated = await this.prisma.profileLock.update({
      where: { profileId },
      data: {
        heartbeatAt: now,
        expiresAt: new Date(now.getTime() + this.lockTtlMs()),
      },
    });
    await this.audit(ctx, "lock.heartbeat", "profile", profileId, {
      expiresAt: updated.expiresAt,
    });
    return updated;
  }

  async unlock(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    const lock = await this.prisma.profileLock.findUnique({
      where: { profileId },
    });
    if (!lock) return { unlocked: true };
    if (ctx.role !== "admin" && lock.lockedByUserId !== ctx.userId) {
      throw new ForbiddenException("Current user does not hold the lock");
    }
    await this.prisma.profileLock.delete({ where: { profileId } });
    await this.audit(
      ctx,
      ctx.role === "admin" && lock.lockedByUserId !== ctx.userId
        ? "lock.admin_unlock"
        : "lock.unlock",
      "profile",
      profileId,
      { lockedByUserId: lock.lockedByUserId },
    );
    return { unlocked: true };
  }

  async scopeObjectKey(ctx: UserContext, key: string): Promise<string> {
    if (!this.isEnabled() || ctx.mode !== "team") return key;
    this.requireTeamContext(ctx);
    if (key.startsWith(`teams/${ctx.teamId}/`)) return key;
    if (key.startsWith("teams/")) throw new ForbiddenException("Wrong team");

    if (this.isTeamScopedPrefix(key)) {
      return `teams/${ctx.teamId}/${key}`;
    }

    if (key.startsWith(`users/${ctx.userId}/`)) return key;
    if (key.startsWith("users/")) throw new ForbiddenException("Wrong user");
    return `users/${ctx.userId}/${key}`;
  }

  async visibleProfileIds(ctx: UserContext): Promise<Set<string> | null> {
    if (!this.isEnabled() || ctx.mode !== "team") return null;
    this.requireTeamContext(ctx);
    if (ctx.role === "admin") return null;
    const permissions = await this.prisma.profilePermission.findMany({
      where: { userId: ctx.userId, profile: { teamId: ctx.teamId } },
      select: { profileId: true },
    });
    return new Set(permissions.map((p) => p.profileId));
  }

  async assertCanReadKey(ctx: UserContext, key: string) {
    if (!this.isEnabled() || ctx.mode !== "team") return;
    this.requireTeamContext(ctx);
    if (key.startsWith(`users/${ctx.userId}/`)) return;
    if (!key.startsWith(`teams/${ctx.teamId}/`)) {
      throw new ForbiddenException("Access denied");
    }
    if (key.startsWith(`teams/${ctx.teamId}/bot_profiles/`)) {
      return;
    }

    const profileId = this.profileIdFromKey(key);
    if (profileId) {
      await this.assertProfileReadable(ctx, profileId);
    }
  }

  async assertCanWriteKey(ctx: UserContext, key: string) {
    if (!this.isEnabled() || ctx.mode !== "team") return;
    this.requireTeamContext(ctx);
    if (key.startsWith(`users/${ctx.userId}/`)) return;
    if (!key.startsWith(`teams/${ctx.teamId}/`)) {
      throw new ForbiddenException("Access denied");
    }

    if (key.startsWith(`teams/${ctx.teamId}/bot_profiles/`)) {
      this.requireAdmin(ctx);
      return;
    }

    const profileId = this.profileIdFromKey(key);
    if (profileId) {
      await this.ensureProfileForSync(ctx, profileId);
      await this.assertProfileWritable(ctx, profileId, true);
    }
  }

  async assertCanDeleteKey(ctx: UserContext, key: string) {
    if (
      this.isEnabled() &&
      ctx.mode === "team" &&
      key === `teams/${ctx.teamId}/profiles/` &&
      ctx.role !== "admin"
    ) {
      throw new ForbiddenException("Profile prefix delete requires admin");
    }
    await this.assertCanWriteKey(ctx, key);
  }

  async assertBotProfileAssetReadable(ctx: UserContext, assetId: string) {
    this.requireTeamContext(ctx);
    const asset = await this.prisma.botProfileAsset.findUnique({
      where: { id: assetId },
    });
    if (!asset || asset.teamId !== ctx.teamId) {
      throw new NotFoundException("Bot profile asset not found");
    }
    return asset;
  }

  async audit(
    ctx: UserContext,
    action: string,
    targetType: string,
    targetId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    if (!this.isEnabled() || ctx.mode !== "team" || !ctx.teamId) return;
    await this.prisma.auditLog.create({
      data: {
        teamId: ctx.teamId,
        userId: ctx.userId,
        action,
        targetType,
        targetId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listAuditLogs(
    ctx: UserContext,
    filters?: {
      limit?: string;
      action?: string;
      targetType?: string;
      targetId?: string;
      userId?: string;
    },
  ) {
    this.requireTeamContext(ctx);
    this.requireAdmin(ctx);
    const limit = Math.min(
      Math.max(Number(filters?.limit || 200) || 200, 1),
      500,
    );
    return this.prisma.auditLog.findMany({
      where: {
        teamId: ctx.teamId,
        action: filters?.action || undefined,
        targetType: filters?.targetType || undefined,
        targetId: filters?.targetId || undefined,
        userId: filters?.userId || undefined,
      },
      include: { user: { select: this.userSelect() } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  private async ensureProfileForSync(ctx: UserContext, profileId: string) {
    const existing = await this.prisma.teamProfile.findUnique({
      where: { id: profileId },
    });
    if (existing) return existing;
    return this.createProfile(ctx, {
      id: profileId,
      name: `Profile ${profileId.slice(0, 8)}`,
      engine: "botbrowser",
    });
  }

  private async assertProfileReadable(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    if (ctx.role === "admin") {
      await this.assertProfileInTeam(ctx, profileId);
      return;
    }
    const permission = await this.prisma.profilePermission.findUnique({
      where: { profileId_userId: { profileId, userId: ctx.userId } },
      include: { profile: true },
    });
    if (
      !permission ||
      permission.profile.teamId !== ctx.teamId ||
      permission.profile.deletedAt
    ) {
      throw new ForbiddenException("Profile access denied");
    }
  }

  private async assertProfileWritable(
    ctx: UserContext,
    profileId: string,
    requireLock: boolean,
  ) {
    this.requireTeamContext(ctx);
    if (ctx.role === "admin") {
      await this.assertProfileInTeam(ctx, profileId);
      if (requireLock) {
        await this.assertUserHoldsLock(ctx, profileId);
      }
      return;
    }
    const permission = await this.prisma.profilePermission.findUnique({
      where: { profileId_userId: { profileId, userId: ctx.userId } },
      include: { profile: true },
    });
    if (
      !permission ||
      permission.profile.teamId !== ctx.teamId ||
      permission.profile.deletedAt ||
      !WRITE_PERMISSIONS.has(permission.permission)
    ) {
      throw new ForbiddenException("Profile write access denied");
    }
    if (requireLock) {
      await this.assertUserHoldsLock(ctx, profileId);
    }
  }

  private async assertUserHoldsLock(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    const lock = await this.prisma.profileLock.findUnique({
      where: { profileId },
    });
    if (
      !lock ||
      lock.lockedByUserId !== ctx.userId ||
      lock.expiresAt <= new Date()
    ) {
      throw new ForbiddenException("Profile lock required before upload");
    }
  }

  private async assertProfileInTeam(ctx: UserContext, profileId: string) {
    this.requireTeamContext(ctx);
    const profile = await this.prisma.teamProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile || profile.teamId !== ctx.teamId || profile.deletedAt) {
      throw new NotFoundException("Profile not found");
    }
  }

  private requireAdmin(ctx: UserContext) {
    if (ctx.role !== "admin") throw new ForbiddenException("Admin required");
  }

  private profileIdFromKey(key: string): string | null {
    const profileMatch = key.match(/^teams\/[^/]+\/profiles\/([^/]+)(?:\/|$)/);
    if (profileMatch?.[1]) return profileMatch[1];

    const tombstoneMatch = key.match(
      /^teams\/[^/]+\/tombstones\/profiles\/([^/]+)(?:\/|$)/,
    );
    return tombstoneMatch?.[1] || null;
  }

  private isTeamScopedPrefix(key: string): boolean {
    return /^(profiles|proxies|groups|extension_groups|extensions|vpns|tombstones|bot_profiles)(\/|$)/.test(
      key,
    );
  }

  private toEngine(engine?: string): BrowserEngine {
    if (engine === "wayfern") return BrowserEngine.wayfern;
    if (engine === "cloak") return BrowserEngine.cloak;
    if (engine === "camoufox") return BrowserEngine.camoufox;
    return BrowserEngine.botbrowser;
  }

  private toPermission(permission: string): ProfilePermissionLevel {
    if (permission === "viewer") return ProfilePermissionLevel.viewer;
    if (permission === "editor") return ProfilePermissionLevel.editor;
    return ProfilePermissionLevel.owner;
  }

  private lockTtlMs(): number {
    return Number(this.config.get<string>("PROFILE_LOCK_TTL_MS") || 1800000);
  }

  private userSelect() {
    return {
      id: true,
      teamId: true,
      email: true,
      role: true,
      disabledAt: true,
      createdAt: true,
    };
  }
}
