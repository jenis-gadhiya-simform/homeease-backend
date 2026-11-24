import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type SessionRecord,
  type SessionStore,
} from '@nestjs/authentication';

/**
 * SlotWise has no server-side sessions: every sign-in issues a bearer access
 * token and the `sw_refresh` cookie. The package's OIDC feature still lists
 * the `sessions` contract as required (its own `finish()` would create one,
 * which `OidcProfileCapture` prevents), and in production it refuses to start
 * without a registered store. This one holds nothing: reads find nothing and
 * creating a session fails loudly, so an accidental package sign-in can
 * never silently create a second kind of login.
 */
@Injectable()
export class NoSessionStore implements SessionStore {
  constructor(storage: AuthenticationStorage) {
    storage.registerSource({ sessions: this });
  }

  getSession(): Promise<SessionRecord | undefined> {
    return Promise.resolve(undefined);
  }

  createSession(): Promise<void> {
    return Promise.reject(
      new Error(
        'Server-side sessions are not used in SlotWise: sign in through AuthTokensService',
      ),
    );
  }

  touchSession(): Promise<void> {
    return Promise.resolve();
  }

  deleteSession(): Promise<boolean> {
    return Promise.resolve(false);
  }

  listUserSessions(): Promise<SessionRecord[]> {
    return Promise.resolve([]);
  }

  deleteUserSessions(): Promise<void> {
    return Promise.resolve();
  }
}
