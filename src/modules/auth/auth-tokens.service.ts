import { Injectable } from '@nestjs/common';
import { TokenService } from '@nestjs/authentication';
import type { Request, Response } from 'express';
import { env, isProduction } from '../../config/env.js';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants.js';
import {
  type AccessTokenClaims,
  type Principal,
  SignInMethod,
} from './auth.types.js';
import { AccountKind } from '../../shared/context/request-context.js';

/** What sign-in endpoints answer; the refresh token goes in a cookie instead. */
export interface AccessTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds. */
  expiresIn: number;
}

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** `30d` → milliseconds (the env schema guarantees the format). */
export function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration "${duration}"`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/** Reads one cookie from the raw header (no cookie-parser middleware needed). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Issues access + refresh tokens (`TokenService`) for staff and customers,
 * and keeps the refresh token in an httpOnly cookie scoped to /auth, so page
 * scripts can never read it.
 */
@Injectable()
export class AuthTokensService {
  constructor(private readonly tokens: TokenService) {}

  /** Starts a refresh-token family for a sign-in and sets the cookie. */
  async signIn(
    principal: Principal,
    method: SignInMethod,
    res: Response,
  ): Promise<AccessTokenResponse> {
    const claims: AccessTokenClaims = {
      kind: principal.kind,
      pa: principal.kind === AccountKind.STAFF && principal.isPlatformAdmin,
      amr: [method],
      auth_time: Math.floor(Date.now() / 1000),
    };
    const pair = await this.tokens.issue(principal.id, {
      claims: { ...claims },
      method: method === SignInMethod.PASSWORD ? 'password' : 'email-link',
    });
    this.setRefreshCookie(res, pair.refreshToken);
    return this.toResponse(pair);
  }

  /** Rotates the cookie's refresh token. A reused one is a 401 and revokes its family. */
  async refresh(refreshToken: string, res: Response) {
    const pair = await this.tokens.refresh(refreshToken);
    this.setRefreshCookie(res, pair.refreshToken);
    return this.toResponse(pair);
  }

  /** Signs this device out. Unknown tokens are ignored (RFC 7009). */
  async signOut(refreshToken: string | undefined, res: Response) {
    if (refreshToken) await this.tokens.revoke(refreshToken);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  /** Ends every refresh-token family of the user (password changed or reset). */
  async signOutEverywhere(userId: string) {
    await this.tokens.revokeAll(userId);
  }

  readRefreshCookie(req: Request): string | undefined {
    return readCookie(req, REFRESH_COOKIE);
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(),
      maxAge: durationToMs(env.REFRESH_TOKEN_TTL),
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict' as const,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private toResponse(pair: {
    accessToken: string;
    expiresIn: number;
  }): AccessTokenResponse {
    return {
      accessToken: pair.accessToken,
      tokenType: 'Bearer',
      expiresIn: pair.expiresIn,
    };
  }
}
