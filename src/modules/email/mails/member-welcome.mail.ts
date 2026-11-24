import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface MemberWelcomeMailData {
  name: string;
  businessName: string;
  /** OWNER, MANAGER, RECEPTIONIST or STAFF, shown in words. */
  roleLabel: string;
  /** Who added them. */
  addedBy: string;
  /** The single-use set-password link. */
  actionUrl: string;
  expiresInHours: number;
}

/** A new team member sets their password (F04). Template: member-welcome.html / .txt. */
@Injectable()
export class MemberWelcomeMail implements Mailable<MemberWelcomeMailData> {
  render(data: MemberWelcomeMailData) {
    return {
      subject: `Join ${data.businessName} on SlotWise`,
      template: 'member-welcome',
      context: data,
    };
  }
}
