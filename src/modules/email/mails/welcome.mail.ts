import { Injectable } from '@nestjs/common';
import type { Mailable } from '@nestjs/mail';

export interface WelcomeMailData {
  name: string;
  actionUrl?: string;
}

/** Template: src/shared/mail/templates/welcome.html (+ welcome.txt). */
@Injectable()
export class WelcomeMail implements Mailable<WelcomeMailData> {
  render(data: WelcomeMailData) {
    return {
      subject: `Welcome, ${data.name}!`,
      template: 'welcome',
      context: data,
    };
  }
}
