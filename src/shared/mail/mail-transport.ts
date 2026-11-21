import {
  FileMailTransport,
  LogMailTransport,
  type MailTransport,
  SmtpTransport,
} from '@nestjs/mail';

/**
 * Picks the mail transport from the environment:
 *
 * - MAIL_TRANSPORT=smtp (default): SMTP_URL, e.g. smtp://localhost:1025 for
 *   Mailpit locally, smtp://user:pass@smtp.example.com:587 in production.
 * - MAIL_TRANSPORT=log: only logs each mail (no SMTP server needed).
 * - MAIL_TRANSPORT=file: writes .eml files to MAIL_DIRECTORY (default var/mail).
 */
export function createMailTransport(
  env: NodeJS.ProcessEnv = process.env,
): MailTransport {
  const kind = env.MAIL_TRANSPORT ?? 'smtp';

  switch (kind) {
    case 'smtp':
      return new SmtpTransport({
        url: env.SMTP_URL ?? 'smtp://localhost:1025',
        // STARTTLS is required except on localhost. Set SMTP_STARTTLS=opportunistic
        // only for a trusted local relay on another host (e.g. a docker service name).
        ...(env.SMTP_STARTTLS && {
          startTls: env.SMTP_STARTTLS as 'required' | 'opportunistic' | 'never',
        }),
      });
    case 'log':
      return new LogMailTransport();
    case 'file':
      return new FileMailTransport({
        directory: env.MAIL_DIRECTORY ?? 'var/mail',
      });
    default:
      throw new Error(
        `Unknown MAIL_TRANSPORT "${kind}": use smtp, log or file`,
      );
  }
}
