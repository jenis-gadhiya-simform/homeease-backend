import { Logger } from '@nestjs/common';
import { MailError, Mailer, MailTemplateError } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import type { EmailJobData } from './email.constants.js';
import { EmailProcessor } from './email.processor.js';
import { WelcomeMail } from './mails/welcome.mail.js';

const job = (name: string, data: EmailJobData, id = '42') =>
  ({ id, name, data, queueName: 'emails' }) as unknown as Job<EmailJobData>;

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  const send = vi.fn();

  beforeEach(async () => {
    send.mockReset();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [EmailProcessor, { provide: Mailer, useValue: { send } }],
    }).compile();
    processor = moduleRef.get(EmailProcessor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the mail class named by the job, with BullMQ owning retries', async () => {
    send.mockResolvedValue({ messageId: '<m1@example.com>' });

    await expect(
      processor.process(
        job('welcome', { to: 'ada@example.com', data: { name: 'Ada' } }),
      ),
    ).resolves.toEqual({ messageId: '<m1@example.com>' });

    expect(send).toHaveBeenCalledWith(WelcomeMail, {
      to: 'ada@example.com',
      data: { name: 'Ada' },
      retry: false,
      idempotencyKey: 'emails:42',
    });
  });

  it('fails an unknown mail without retrying', async () => {
    await expect(
      processor.process(
        job('nope', { to: 'a@example.com', data: { name: 'A' } }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not retry permanent mail errors (e.g. a broken template, SMTP 5xx)', async () => {
    send.mockRejectedValue(
      new MailTemplateError('missing template', { template: 'welcome' }),
    );

    await expect(
      processor.process(
        job('welcome', { to: 'a@example.com', data: { name: 'A' } }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('rethrows transient errors so BullMQ retries with backoff', async () => {
    const transient = new MailError('connection refused', { permanent: false });
    send.mockRejectedValue(transient);

    await expect(
      processor.process(
        job('welcome', { to: 'a@example.com', data: { name: 'A' } }),
      ),
    ).rejects.toBe(transient);
  });
});
