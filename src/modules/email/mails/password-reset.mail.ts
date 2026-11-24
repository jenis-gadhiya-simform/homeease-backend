import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface PasswordResetMailData {
  actionUrl: string;
  expiresInMinutes: number;
  /** Staff users have a name; customer accounts don't. */
  name?: string;
}

/** Password-reset link for staff and customers (F02). Template: password-reset.html / .txt. */
@Injectable()
export class PasswordResetMail implements Mailable<PasswordResetMailData> {
  render(data: PasswordResetMailData) {
    return {
      subject: 'Reset your SlotWise password',
      template: 'password-reset',
      context: data,
    };
  }
}
