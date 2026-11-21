import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { Mailer } from '@nestjs/mail';
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { EmailService } from './email.service.js';
import { WelcomeMail } from './mails/welcome.mail.js';

export const sendTestEmailSchema = z.object({
  to: z.email(),
  name: z.string().trim().min(1).max(100).default('there'),
});
export type SendTestEmail = z.infer<typeof sendTestEmailSchema>;

const previewQuerySchema = z.string().trim().min(1).max(100).default('Ada');

/**
 * Development-only routes (not registered when NODE_ENV=production):
 * send a test email to Mailpit, or preview a template in the browser.
 */
@ApiTags('Dev: Email')
@Controller('dev/emails')
export class DevEmailController {
  constructor(
    private readonly emails: EmailService,
    private readonly mailer: Mailer,
  ) {}

  @Post('welcome')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Queue a welcome email (open Mailpit at http://localhost:8025 to see it)',
  })
  @ApiAcceptedResponse({ schema: { example: { jobId: '1' } } })
  async sendWelcome(
    @Body({ schema: sendTestEmailSchema }) body: SendTestEmail,
  ) {
    const jobId = await this.emails.enqueue('welcome', body.to, {
      name: body.name,
      actionUrl: 'http://localhost:3000/docs',
    });
    return { jobId };
  }

  @Get('preview/welcome')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({
    summary: 'Render the welcome email as HTML without sending it',
  })
  @ApiOkResponse({ description: 'The rendered email HTML' })
  async previewWelcome(
    @Query('name', { schema: previewQuerySchema }) name: string,
  ) {
    const message = await this.mailer.render(WelcomeMail, {
      to: 'preview@example.com',
      data: { name, actionUrl: 'http://localhost:3000/docs' },
    });
    return message.html;
  }
}
