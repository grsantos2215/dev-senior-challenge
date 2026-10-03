import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";

import { AppModule } from "./app.module.js";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";

async function server() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.useGlobalPipes(new ValidationPipe({}));

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await server();
