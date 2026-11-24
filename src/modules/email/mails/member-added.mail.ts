import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface MemberAddedMailData {
  name: string;
  businessName: string;
  roleLabel: string;
  addedBy: string;
  /** The sign-in page. */
  actionUrl: string;
}

/** An existing staff user was added to another business (F04). Template: member-added.html / .txt. */
@Injectable()
export class MemberAddedMail implements Mailable<MemberAddedMailData> {
  render(data: MemberAddedMailData) {
    return {
      subject: `You've been added to ${data.businessName}`,
      template: 'member-added',
      context: data,
    };
  }
}
