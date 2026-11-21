import type { Type } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';
import { WelcomeMail } from './mails/welcome.mail.js';

export const EMAIL_QUEUE = 'emails';

/**
 * Every mail the app can send, by the name stored in the queue job.
 * Jobs hold plain JSON, so the processor looks the mail class up here.
 * Add new mails to this map.
 */
export const MAILS = {
  welcome: WelcomeMail,
} as const satisfies Record<string, Type<Mailable<any>>>;

export type MailName = keyof typeof MAILS;
/** The data a mail's render() takes, e.g. MailDataOf<'welcome'> = WelcomeMailData. */
export type MailDataOf<N extends MailName> = Parameters<
  InstanceType<(typeof MAILS)[N]>['render']
>[0];

export interface EmailJobData<N extends MailName = MailName> {
  to: string;
  data: MailDataOf<N>;
}
