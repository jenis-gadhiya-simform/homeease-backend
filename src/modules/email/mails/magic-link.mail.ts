import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface MagicLinkMailData {
  actionUrl: string;
  expiresInMinutes: number;
  /** Set once tenancy (F01) resolves the booking page's business. */
  businessName?: string;
}

/** Customer sign-in link (F02). Template: magic-link.html / .txt. */
@Injectable()
export class MagicLinkMail implements Mailable<MagicLinkMailData> {
  render(data: MagicLinkMailData) {
    return {
      subject: 'Your SlotWise sign-in link',
      template: 'magic-link',
      context: data,
    };
  }
}
