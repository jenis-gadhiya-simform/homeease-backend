import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  OidcAccountResolver,
  type OidcProfile,
} from '@nestjs/authentication';

/**
 * Thrown by `OidcProfileCapture` to hand the verified profile back to our
 * callback handler. Not an HTTP error: `SocialSignInService.finish()`
 * catches it, and nothing else ever sees it.
 */
export class VerifiedOidcProfile extends Error {
  constructor(readonly profile: OidcProfile) {
    super('Verified OIDC profile (handled by SocialSignInService)');
  }
}

/**
 * The package's `OidcService.finish()` checks state, PKCE and the ID token,
 * asks the resolver for a user, then signs that user in with a server-side
 * **session cookie**. SlotWise has no sessions: it signs in with bearer
 * access tokens and the `sw_refresh` cookie. So this resolver stops the flow
 * right after verification, carrying the profile out in an exception;
 * `SocialSignInService` then applies the account rules and issues our tokens.
 * The package never reaches its session step.
 */
@Injectable()
export class OidcProfileCapture extends OidcAccountResolver {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerHandler('oidc', this);
  }

  resolveUser(profile: OidcProfile): never {
    throw new VerifiedOidcProfile(profile);
  }
}
