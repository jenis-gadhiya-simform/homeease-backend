import { HttpStatus, Injectable } from '@nestjs/common';
import { PasswordHasher } from '@nestjs/authentication';
import { DomainError, ErrorCode } from '../../shared/errors/domain-error.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import type { CustomerPrincipal, StaffPrincipal } from './auth.types.js';
import { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import { UsersRepository } from './repositories/users.repository.js';

export const invalidCredentials = () =>
  new DomainError(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.InvalidCredentials,
    'Invalid email or password',
  );

/**
 * Password sign-in for staff and customers. Every failure (unknown email,
 * wrong password, no password yet, pending setup, disabled) is the same 401
 * after the same work: the hash is always checked, against a dummy one when
 * there is none, so neither the answer nor its timing reveals which emails
 * have accounts.
 */
@Injectable()
export class SignInService {
  constructor(
    private readonly users: UsersRepository,
    private readonly customers: CustomerAccountsRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: AuthRateLimiter,
  ) {}

  async verifyStaff(email: string, password: string): Promise<StaffPrincipal> {
    await this.limiter.hit('staff-login', email);
    const found = await this.users.findCredentials(email);
    const valid = await this.hasher.verify(password, found?.passwordHash);
    if (!valid || !found?.passwordHash || found.status !== 'ACTIVE') {
      throw invalidCredentials();
    }
    if (this.hasher.needsRehash(found.passwordHash)) {
      await this.users.updatePasswordHash(
        found.user.id,
        await this.hasher.hash(password),
      );
    }
    return found.user;
  }

  async verifyCustomer(
    email: string,
    password: string,
  ): Promise<CustomerPrincipal> {
    await this.limiter.hit('customer-login', email);
    const found = await this.customers.findCredentials(email);
    const valid = await this.hasher.verify(password, found?.passwordHash);
    if (!valid || !found?.passwordHash) throw invalidCredentials();
    if (this.hasher.needsRehash(found.passwordHash)) {
      await this.customers.updatePasswordHash(
        found.account.id,
        await this.hasher.hash(password),
      );
    }
    return found.account;
  }
}
