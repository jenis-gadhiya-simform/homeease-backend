import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Mailer, MailError } from '@nestjs/mail';
import { type Job, UnrecoverableError } from 'bullmq';
import {
  EMAIL_QUEUE,
  type EmailJobData,
  MAILS,
  type MailName,
} from './email.constants.js';

/**
 * Sends queued emails. Transient failures (SMTP 4xx, timeouts, connection
 * errors) are retried by BullMQ with backoff; permanent ones (SMTP 5xx, a
 * broken template, an unknown mail) fail the job at once.
 */
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly mailer: Mailer) {
    super();
  }

  async process(job: Job<EmailJobData>) {
    const mail = MAILS[job.name as MailName];
    if (!mail) {
      throw new UnrecoverableError(`Unknown mail "${job.name}"`);
    }

    try {
      const result = await this.mailer.send(mail, {
        to: job.data.to,
        data: job.data.data,
        // BullMQ owns retries; the job id keeps a retried send idempotent
        // with providers that support it.
        retry: false,
        idempotencyKey: `${job.queueName}:${job.id}`,
      });
      this.logger.log(
        { jobId: job.id, mail: job.name, messageId: result.messageId },
        'Email sent',
      );
      return { messageId: result.messageId };
    } catch (error) {
      if (error instanceof MailError && error.permanent) {
        throw new UnrecoverableError(`${error.name}: ${error.message}`);
      }
      throw error;
    }
  }
}
