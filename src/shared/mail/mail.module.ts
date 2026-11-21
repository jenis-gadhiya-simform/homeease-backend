import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { FileTemplateEngine, MailModule } from '@nestjs/mail';
import { createMailTransport } from './mail-transport.js';
import { env, isProduction } from '../../config/env.js';

/** Where mail templates live: next to this file in src/, copied to dist/ on build. */
export const MAIL_TEMPLATES_DIR = join(import.meta.dirname, 'templates');

/**
 * Shared mail setup (@nestjs/mail): transport, templates and default sender.
 * `Mailer` is global: inject it anywhere. Feature code normally goes through
 * EmailModule's queue instead of sending directly (see docs/architecture.md).
 */
@Module({
  imports: [
    MailModule.forRoot({
      transport: createMailTransport(),
      templates: new FileTemplateEngine({
        dir: MAIL_TEMPLATES_DIR,
        layout: 'layout',
        // Reread templates on every send outside production, for quick edits.
        cache: isProduction,
      }),
      from: env.MAIL_FROM,
      // Retries happen in the BullMQ email queue, not inside Mailer.send().
      retry: false,
    }),
  ],
})
export class SharedMailModule {}
