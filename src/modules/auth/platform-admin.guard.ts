import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import type { Principal } from './auth.types.js';

/**
 * Platform-admin routes (`/admin/*`). Reads `User.isPlatformAdmin` as loaded
 * from the database for this request (never the token's `pa` claim).
 * Owners, Managers, Staff and customers get 403.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: Principal }>().user;
    if (user?.kind !== 'staff' || !user.isPlatformAdmin) {
      throw new DomainError(
        HttpStatus.FORBIDDEN,
        ErrorCode.Forbidden,
        'Platform admins only',
      );
    }
    return true;
  }
}

/** Only the platform admin may call this route or controller. */
export const PlatformAdminOnly = () =>
  applyDecorators(UseGuards(PlatformAdminGuard));
