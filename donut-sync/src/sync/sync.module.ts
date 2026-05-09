import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { TeamModule } from "../team/team.module.js";
import { InternalController } from "./internal.controller.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";

@Module({
  imports: [AuthModule, TeamModule],
  controllers: [SyncController, InternalController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
