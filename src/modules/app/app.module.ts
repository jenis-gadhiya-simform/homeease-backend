import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ObserveModule } from '../../config/observe.js';
import { LoggingModule } from '../logger/logger.module.js';

@Module({
  imports: [
    ObserveModule.forRoot({
      enabled: process.env.NODE_ENV === 'production',
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    LoggingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
