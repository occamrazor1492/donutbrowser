import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";
import type { LoginRequestDto, LoginResponseDto } from "./dto/auth.dto.js";
import type { UserContext } from "./user-context.interface.js";

@Controller("v1")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("auth/login")
  async login(@Body() dto: LoginRequestDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Post("auth/logout")
  logout() {
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    const user = (req as unknown as Record<string, unknown>)
      .user as UserContext;
    return { user };
  }
}
