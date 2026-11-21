import {
  FileMailTransport,
  LogMailTransport,
  type MailTransport,
  SmtpTransport,
} from '@nestjs/mail';
import { type Env, env as appEnv } from '../../config/env.js';

type MailEnv = Pick<
  Env,
  'MAIL_TRANSPORT' | 'SMTP_URL' | 'SMTP_STARTTLS' | 'MAIL_DIRECTORY'
>;

/**
 * Picks the mail transport from the environment:
 *
 * - MAIL_TRANSPORT=smtp (default): SMTP_URL, e.g. smtp://localhost:1025 for
 *   Mailpit locally, smtp://user:pass@smtp.example.com:587 in production.
 * - MAIL_TRANSPORT=log: only logs each mail (no SMTP server needed).
 * - MAIL_TRANSPORT=file: writes .eml files to MAIL_DIRECTORY (default var/mail).
 */
export function createMailTransport(env: MailEnv = appEnv): MailTransport {
  switch (env.MAIL_TRANSPORT) {
    case 'smtp':
      return new SmtpTransport({
        url: env.SMTP_URL,
        // STARTTLS is required except on localhost. Set SMTP_STARTTLS=opportunistic
        // only for a trusted local relay on another host (e.g. a docker service name).
        ...(env.SMTP_STARTTLS && { startTls: env.SMTP_STARTTLS }),
      });
    case 'log':
      return new LogMailTransport();
    case 'file':
      return new FileMailTransport({ directory: env.MAIL_DIRECTORY });
  }
}
