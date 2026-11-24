import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface OwnerWelcomeMailData {
  name: string;
  businessName: string;
  /** The single-use set-password link. */
  actionUrl: string;
  expiresInHours: number;
}

/** A new Owner sets their password (F01). Template: owner-welcome.html / .txt. */
@Injectable()
export class OwnerWelcomeMail implements Mailable<OwnerWelcomeMailData> {
  render(data: OwnerWelcomeMailData) {
    return {
      subject: `Set your password for ${data.businessName}`,
      template: 'owner-welcome',
      context: data,
    };
  }
}
