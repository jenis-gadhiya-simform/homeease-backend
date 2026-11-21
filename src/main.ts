import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    // Hold startup logs until pino is ready, then replay them through it.
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
