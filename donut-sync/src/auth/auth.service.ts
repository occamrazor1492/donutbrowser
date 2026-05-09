import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import * as jwt from "jsonwebtoken";
import { PrismaService } from "../prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { UserContext } from "./user-context.interface.js";

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.isMultiUserEnabled()) return;
    await this.ensureAdminUser();
  }

  isMultiUserEnabled(): boolean {
    return this.config.get<string>("MULTI_USER_ENABLED") === "true";
  }

  getJwtSecret(): string {
    const secret = this.config.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is required when MULTI_USER_ENABLED=true");
    }
    return secret;
  }

  async ensureAdminUser() {
    const email = this.config.get<string>("ADMIN_EMAIL");
    const password = this.config.get<string>("ADMIN_PASSWORD");
    if (!email || !password) {
      throw new Error(
        "ADMIN_EMAIL and ADMIN_PASSWORD are required when MULTI_USER_ENABLED=true",
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    const team = await this.prisma.team.create({
      data: { name: this.config.get<string>("TEAM_NAME") || "Default Team" },
    });

    await this.prisma.user.create({
      data: {
        teamId: team.id,
        email,
        passwordHash: hashPassword(password),
        role: UserRole.admin,
      },
    });

    this.logger.log(`Created initial admin user ${email}`);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { team: true },
    });

    if (
      !user ||
      user.disabledAt ||
      !verifyPassword(password, user.passwordHash)
    ) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const token = this.signTeamToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        teamId: user.teamId,
        teamName: user.team.name,
      },
    };
  }

  signTeamToken(input: {
    userId: string;
    email: string;
    role: "admin" | "member";
    teamId: string;
  }): string {
    const expiresIn = (this.config.get<string>("JWT_EXPIRES_IN") ||
      "30d") as jwt.SignOptions["expiresIn"];
    return jwt.sign(
      {
        sub: input.userId,
        email: input.email,
        role: input.role,
        teamId: input.teamId,
        prefix: `users/${input.userId}/`,
        teamPrefix: `teams/${input.teamId}/`,
        profileLimit: 0,
        teamProfileLimit: 0,
      },
      this.getJwtSecret() as jwt.Secret,
      { expiresIn },
    );
  }

  verifyTeamToken(token: string): UserContext {
    const decoded = jwt.verify(token, this.getJwtSecret(), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    const userId = String(decoded.sub || "");
    const teamId = String(decoded.teamId || "");
    if (!userId || !teamId) {
      throw new UnauthorizedException("Invalid team token");
    }

    return {
      mode: "team",
      userId,
      email: typeof decoded.email === "string" ? decoded.email : undefined,
      role: decoded.role === "admin" ? "admin" : "member",
      teamId,
      prefix: `users/${userId}/`,
      teamPrefix: `teams/${teamId}/`,
      profileLimit: 0,
      teamProfileLimit: 0,
    };
  }
}
