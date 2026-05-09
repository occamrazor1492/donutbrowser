import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

function validateEnv() {
  if (process.env.MULTI_USER_ENABLED === "true") {
    if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
      console.error(
        "DATABASE_URL and JWT_SECRET must be set when MULTI_USER_ENABLED=true",
      );
      process.exit(1);
    }
    return;
  }

  if (!process.env.SYNC_TOKEN && !process.env.SYNC_JWT_PUBLIC_KEY) {
    console.error("Either SYNC_TOKEN or SYNC_JWT_PUBLIC_KEY must be set");
    process.exit(1);
  }
}

async function bootstrap() {
  validateEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // biome-ignore lint/correctness/useHookAtTopLevel: NestJS method, not a React hook
  app.useBodyParser("json", { limit: "50mb" });

  app.enableCors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  const port = process.env.PORT ?? 3929;
  await app.listen(port);
  console.log(`Donut Sync service running on port ${port}`);
}
void bootstrap();
