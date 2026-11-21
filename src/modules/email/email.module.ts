import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DevEmailController } from './dev-email.controller.js';
import { EMAIL_QUEUE, MAILS } from './email.constants.js';
import { EmailProcessor } from './email.processor.js';
import { EmailService } from './email.service.js';

/**
 * App emails: mail classes, the "emails" queue and its processor.
 * Other modules import EmailModule and call `EmailService.enqueue()`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  controllers:
    process.env.NODE_ENV === 'production' ? [] : [DevEmailController],
  providers: [EmailService, EmailProcessor, ...Object.values(MAILS)],
  exports: [EmailService],
})
export class EmailModule {}
