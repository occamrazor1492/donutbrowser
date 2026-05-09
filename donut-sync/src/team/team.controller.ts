import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import type { UserContext } from "../auth/user-context.interface.js";
import { TeamService } from "./team.service.js";

function ctx(req: Request): UserContext {
  return (req as unknown as Record<string, unknown>).user as UserContext;
}

@Controller("v1")
@UseGuards(AuthGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post("admin/users")
  createUser(
    @Req() req: Request,
    @Body() body: {
      email: string;
      password: string;
      role?: "admin" | "member";
    },
  ) {
    return this.teamService.createUser(ctx(req), body);
  }

  @Get("admin/users")
  listUsers(@Req() req: Request) {
    return this.teamService.listUsers(ctx(req));
  }

  @Patch("admin/users/:id")
  updateUser(
    @Req() req: Request,
    @Param("id") id: string,
    @Body()
    body: { password?: string; role?: "admin" | "member"; disabled?: boolean },
  ) {
    return this.teamService.updateUser(ctx(req), id, body);
  }

  @Post("admin/bot-profiles")
  uploadBotProfile(
    @Req() req: Request,
    @Body()
    body: {
      name: string;
      contentBase64: string;
      browserMajorVersion?: string;
      platform?: string;
    },
  ) {
    return this.teamService.uploadBotProfileAsset(ctx(req), body);
  }

  @Get("admin/bot-profiles")
  listBotProfiles(@Req() req: Request) {
    return this.teamService.listBotProfileAssets(ctx(req));
  }

  @Delete("admin/bot-profiles/:id")
  deleteBotProfile(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.deleteBotProfileAsset(ctx(req), id);
  }

  @Get("admin/audit-logs")
  listAuditLogs(@Req() req: Request) {
    return this.teamService.listAuditLogs(ctx(req));
  }

  @Get("team-profiles")
  listProfiles(@Req() req: Request) {
    return this.teamService.listProfiles(ctx(req));
  }

  @Post("team-profiles")
  createProfile(
    @Req() req: Request,
    @Body()
    body: {
      id?: string;
      name: string;
      engine?: "botbrowser" | "wayfern" | "camoufox";
      botProfileAssetId?: string | null;
      syncMode?: string;
    },
  ) {
    return this.teamService.createProfile(ctx(req), body);
  }

  @Get("team-profiles/:id")
  getProfile(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.getProfile(ctx(req), id);
  }

  @Patch("team-profiles/:id")
  updateProfile(
    @Req() req: Request,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      engine?: "botbrowser" | "wayfern" | "camoufox";
      botProfileAssetId?: string | null;
      syncMode?: string;
    },
  ) {
    return this.teamService.updateProfile(ctx(req), id, body);
  }

  @Delete("team-profiles/:id")
  deleteProfile(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.deleteProfile(ctx(req), id);
  }

  @Post("team-profiles/:id/permissions")
  setPermission(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { userId: string; permission: "owner" | "editor" | "viewer" },
  ) {
    return this.teamService.setProfilePermission(
      ctx(req),
      id,
      body.userId,
      body.permission,
    );
  }

  @Delete("team-profiles/:id/permissions/:userId")
  deletePermission(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("userId") userId: string,
  ) {
    return this.teamService.deleteProfilePermission(ctx(req), id, userId);
  }

  @Post("team-profiles/:id/lock")
  lock(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.acquireLock(ctx(req), id);
  }

  @Post("team-profiles/:id/lock/heartbeat")
  heartbeat(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.heartbeatLock(ctx(req), id);
  }

  @Post("team-profiles/:id/unlock")
  unlock(@Req() req: Request, @Param("id") id: string) {
    return this.teamService.unlock(ctx(req), id);
  }
}
