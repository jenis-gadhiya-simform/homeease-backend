import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import type { Principal, PrincipalKind } from './auth.types.js';

const ACCOUNT_KIND = 'auth:account-kind';

/**
 * Runs after the global authentication guard (which sets `request.user`):
 * a customer token on a staff route, or the reverse, is a 403.
 */
@Injectable()
export class AccountKindGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const kind = this.reflector.getAllAndOverride<PrincipalKind | undefined>(
      ACCOUNT_KIND,
      [context.getHandler(), context.getClass()],
    );
    if (!kind) return true;
    const user = context.switchToHttp().getRequest<{ user?: Principal }>().user;
    if (user?.kind !== kind) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.WrongAccountType,
        kind === 'staff'
          ? 'This endpoint is for staff accounts'
          : 'This endpoint is for customer accounts',
      );
    }
    return true;
  }
}

/** Only staff-side users (platform admin included) may call this route. */
export const StaffOnly = () =>
  applyDecorators(
    SetMetadata(ACCOUNT_KIND, 'staff'),
    UseGuards(AccountKindGuard),
  );

/** Only customer accounts may call this route. */
export const CustomerOnly = () =>
  applyDecorators(
    SetMetadata(ACCOUNT_KIND, 'customer'),
    UseGuards(AccountKindGuard),
  );
