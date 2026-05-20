import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminWebController } from "./admin-web.controller.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { SyncModule } from "./sync/sync.module.js";
import { TeamModule } from "./team/team.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    TeamModule,
    SyncModule,
  ],
  controllers: [AppController, AdminWebController],
  providers: [AppService],
})
export class AppModule {}
