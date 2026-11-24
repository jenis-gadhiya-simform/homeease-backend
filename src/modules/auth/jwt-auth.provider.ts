import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import {
  AccountKind,
  PLATFORM_ADMIN_ROLE,
  RequestContext,
} from '../../shared/context/request-context.js';
import type { Principal } from './auth.types.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import { UsersRepository } from './repositories/users.repository.js';

/**
 * `Authorization: Bearer <access token>` for staff and customers. Verifies
 * with the module's `accessToken` options, then loads the principal from the
 * database on every request, so a disabled user or a deleted account is
 * locked out at once (not when the token expires).
 */
@Injectable()
export class JwtAuth extends JwtBearerProvider<Principal> {
  constructor(
    private readonly users: UsersRepository,
    private readonly customers: CustomerAccountsRepository,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this);
  }

  protected async validate(claims: JwtClaims): Promise<Principal | null> {
    if (!claims.sub) return null;
    const principal =
      claims.kind === AccountKind.STAFF
        ? await this.users.findActivePrincipal(claims.sub)
        : claims.kind === AccountKind.CUSTOMER
          ? await this.customers.findPrincipal(claims.sub)
          : null;
    if (principal && RequestContext.current()) {
      RequestContext.setActor({
        kind: principal.kind,
        userId: principal.id,
        // Tenant roles are resolved per request by the tenant guard (F01).
        role:
          principal.kind === AccountKind.STAFF && principal.isPlatformAdmin
            ? PLATFORM_ADMIN_ROLE
            : null,
        tenantId: null,
      });
    }
    return principal;
  }
}
