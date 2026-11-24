import {
  createSign,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from 'node:crypto';

/** Claims the fake provider puts in the ID token for one login. */
export interface FakeIdentity {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface PendingCode {
  clientId: string;
  nonce: string;
  identity: FakeIdentity;
}

/**
 * Google, as far as the OIDC client sees it: discovery, a key set and a
 * token endpoint, answered through a stubbed global `fetch` (any other URL
 * goes to the real one). ID tokens are RS256, signed with a key made here.
 *
 * A test plays the browser: it reads the authorization URL our login route
 * redirected to, "signs in" with `authorize()`, and gets the `code` and
 * `state` the provider would send back to our callback.
 */
export class FakeGoogle {
  readonly issuer = 'https://accounts.google.com';
  private readonly tokenEndpoint = 'https://oauth2.googleapis.com/token';
  private readonly jwksUri = 'https://www.googleapis.com/oauth2/v3/certs';
  private readonly kid = 'fake-google-key';
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly codes = new Map<string, PendingCode>();
  private realFetch: typeof fetch = globalThis.fetch;

  constructor() {
    ({ privateKey: this.privateKey, publicKey: this.publicKey } =
      generateKeyPairSync('rsa', { modulusLength: 2048 }));
  }

  install() {
    this.realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      this.handle(input, init),
    );
  }

  uninstall() {
    vi.unstubAllGlobals();
  }

  /**
   * The user signs in at the provider. Returns what the provider redirects
   * back with. `nonce` overrides the one the login asked for (tampering).
   */
  authorize(
    authorizationUrl: string,
    identity: FakeIdentity,
    overrides: { nonce?: string } = {},
  ): { code: string; state: string } {
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state');
    const nonce = url.searchParams.get('nonce');
    const clientId = url.searchParams.get('client_id');
    if (!state || !nonce || !clientId) {
      throw new Error(`Not an OIDC authorization URL: ${authorizationUrl}`);
    }
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, {
      clientId,
      nonce: overrides.nonce ?? nonce,
      identity,
    });
    return { code, state };
  }

  private async handle(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      return json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/o/oauth2/v2/auth`,
        token_endpoint: this.tokenEndpoint,
        jwks_uri: this.jwksUri,
      });
    }
    if (url === this.jwksUri) {
      return json({
        keys: [
          {
            ...this.publicKey.export({ format: 'jwk' }),
            kid: this.kid,
            alg: 'RS256',
            use: 'sig',
          },
        ],
      });
    }
    if (url === this.tokenEndpoint) {
      const body = new URLSearchParams(init?.body as URLSearchParams | string);
      const code = body.get('code') ?? '';
      const pending = this.codes.get(code);
      this.codes.delete(code); // codes work once, as at a real provider
      if (!pending) return json({ error: 'invalid_grant' }, 400);
      return json({
        access_token: randomBytes(16).toString('hex'),
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: this.idToken(pending),
      });
    }
    return this.realFetch(input, init);
  }

  private idToken({ clientId, nonce, identity }: PendingCode): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid: this.kid };
    const payload = {
      iss: this.issuer,
      aud: clientId,
      azp: clientId,
      iat: now,
      exp: now + 3600,
      nonce,
      ...identity,
    };
    const signingInput = `${base64url(header)}.${base64url(payload)}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.privateKey)
      .toString('base64url');
    return `${signingInput}.${signature}`;
  }
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
