import { Injectable } from '@nestjs/common';
import {
  AuthenticationStorage,
  type OidcStateStore,
  type OidcTransaction,
} from '@nestjs/authentication';
import { InjectRedis } from '@nestjs-redis/client';
import type { RedisClientType } from 'redis';

const key = (state: string) => `oidc-state:${state}`;

type StoredTransaction = Omit<OidcTransaction, 'createdAt' | 'expiresAt'> & {
  createdAt: string;
  expiresAt: string;
};

/**
 * Social logins in progress (PKCE verifier, nonce), between the redirect to
 * Google / Microsoft and the callback. In Redis so any instance can finish a
 * login another started; each key expires with its login, which keeps the
 * store bounded. `consume` is one atomic GETDEL, so a callback replayed
 * concurrently finishes at most once.
 */
@Injectable()
export class RedisOidcStateStore implements OidcStateStore {
  constructor(
    @InjectRedis() private readonly redis: RedisClientType,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ oidcStates: this });
  }

  async saveOidcState(transaction: OidcTransaction): Promise<void> {
    const ttlMs = Math.max(
      1,
      transaction.expiresAt.getTime() - transaction.createdAt.getTime(),
    );
    await this.redis.set(key(transaction.state), JSON.stringify(transaction), {
      expiration: { type: 'PX', value: ttlMs },
    });
  }

  async consumeOidcState(state: string): Promise<OidcTransaction | undefined> {
    const raw = await this.redis.getDel(key(state));
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as StoredTransaction;
    return {
      ...stored,
      createdAt: new Date(stored.createdAt),
      expiresAt: new Date(stored.expiresAt),
    };
  }
}
