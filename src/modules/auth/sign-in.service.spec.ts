import { PasswordHasher } from '@nestjs/authentication';
import type { AuthRateLimiter } from './auth-rate-limiter.js';
import type { CustomerAccountsRepository } from './repositories/customer-accounts.repository.js';
import type { UsersRepository } from './repositories/users.repository.js';
import { SignInService } from './sign-in.service.js';

describe('SignInService', () => {
  // One step above the weakest cost, so a logN 10 hash counts as outdated.
  const hasher = new PasswordHasher({ logN: 11 });
  const users = {
    findCredentials: vi.fn(),
    updatePasswordHash: vi.fn(),
  };
  const customers = { findCredentials: vi.fn(), updatePasswordHash: vi.fn() };
  const limiter = { hit: vi.fn() };
  let service: SignInService;
  let verify: ReturnType<typeof vi.spyOn>;

  const staffUser = {
    kind: 'staff' as const,
    id: 'u1',
    email: 'a@x.example',
    name: 'A',
    isPlatformAdmin: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    verify = vi.spyOn(hasher, 'verify');
    service = new SignInService(
      users as unknown as UsersRepository,
      customers as unknown as CustomerAccountsRepository,
      hasher,
      limiter as unknown as AuthRateLimiter,
    );
  });

  afterEach(() => {
    verify.mockRestore();
  });

  it('checks a hash even for an unknown email (no timing oracle)', async () => {
    users.findCredentials.mockResolvedValue(null);
    await expect(
      service.verifyStaff('nobody@x', 'whatever pw'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(verify).toHaveBeenCalledWith('whatever pw', undefined);
  });

  it('checks a hash for a pending user with no password, then refuses', async () => {
    users.findCredentials.mockResolvedValue({
      user: staffUser,
      status: 'PENDING_SETUP',
      passwordHash: null,
    });
    await expect(
      service.verifyStaff('a@x.example', 'pw pw pw pw'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(verify).toHaveBeenCalledWith('pw pw pw pw', null);
  });

  it('refuses a disabled user even with the right password', async () => {
    users.findCredentials.mockResolvedValue({
      user: staffUser,
      status: 'DISABLED',
      passwordHash: await hasher.hash('right password'),
    });
    await expect(
      service.verifyStaff('a@x.example', 'right password'),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('returns the user for the right password and counts the attempt', async () => {
    users.findCredentials.mockResolvedValue({
      user: staffUser,
      status: 'ACTIVE',
      passwordHash: await hasher.hash('right password'),
    });
    await expect(
      service.verifyStaff('a@x.example', 'right password'),
    ).resolves.toEqual(staffUser);
    expect(limiter.hit).toHaveBeenCalledWith('staff-login', 'a@x.example');
    expect(users.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('rehashes a password stored with weaker parameters', async () => {
    const weak = new PasswordHasher({ logN: 10 });
    users.findCredentials.mockResolvedValue({
      user: staffUser,
      status: 'ACTIVE',
      passwordHash: await weak.hash('right password'),
    });
    await service.verifyStaff('a@x.example', 'right password');
    expect(users.updatePasswordHash).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
    );
  });

  it('refuses a magic-link-only customer at password sign-in', async () => {
    customers.findCredentials.mockResolvedValue({
      account: { kind: 'customer', id: 'c1' },
      passwordHash: null,
    });
    await expect(
      service.verifyCustomer('c@x', 'any password'),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(verify).toHaveBeenCalledWith('any password', null);
  });
});
