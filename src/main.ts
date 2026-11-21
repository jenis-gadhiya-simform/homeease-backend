import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { configureApp } from './config/app.setup.js';
import { ObserveInstrument } from './config/observe.js';
import { isSwaggerEnabled, setupSwagger } from './config/swagger.js';
import { AppModule } from './modules/app/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
    // Hold startup logs until pino is ready, then replay them through it.
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  configureApp(app);

  // Run shutdown hooks on SIGTERM: drain /ready, close Redis, flush telemetry.
  app.enableShutdownHooks();

  if (isSwaggerEnabled()) {
    setupSwagger(app);
  }

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
