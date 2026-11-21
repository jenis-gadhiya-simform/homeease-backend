import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  EMAIL_QUEUE,
  type EmailJobData,
  type MailDataOf,
  type MailName,
} from './email.constants.js';

export interface EnqueueEmailOptions {
  /**
   * Identifies this email so it is queued once, e.g. `welcome-${userId}`.
   * BullMQ rejects ids containing `:`.
   * Queuing again with the same id while the job exists is a no-op.
   */
  jobId?: string;
  /** Send later, in milliseconds. */
  delay?: number;
}

/** Sends app emails through the BullMQ "emails" queue (retried on failure). */
@Injectable()
export class EmailService {
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJobData>,
  ) {}

  async enqueue<N extends MailName>(
    mail: N,
    to: string,
    data: MailDataOf<N>,
    options: EnqueueEmailOptions = {},
  ): Promise<string> {
    const job = await this.queue.add(mail, { to, data }, options);
    return job.id!;
  }
}
