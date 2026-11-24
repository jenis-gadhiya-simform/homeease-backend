import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface OwnerAddedMailData {
  name: string;
  businessName: string;
  /** The sign-in page. */
  actionUrl: string;
}

/** An existing staff user was made Owner of another business (F01). Template: owner-added.html / .txt. */
@Injectable()
export class OwnerAddedMail implements Mailable<OwnerAddedMailData> {
  render(data: OwnerAddedMailData) {
    return {
      subject: `You're now the Owner of ${data.businessName}`,
      template: 'owner-added',
      context: data,
    };
  }
}
