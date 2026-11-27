import { Controller, Get, type INestApplication, Patch } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { AuthorizationModule, Can } from '@nestjs/authorization';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MemberRole } from '../../generated/prisma/client.js';
import { PLATFORM_ADMIN_ROLE } from '../../shared/context/request-context.js';
import type { Subject } from '../../shared/context/subject.js';
import { TenantScoped } from '../tenancy/tenant-resolver.js';
import {
  authorizationProblems,
  readDeclarations,
  type RouteDeclarations,
} from './authorization-coverage.js';
import { ANY_MEMBER, Roles, UsePolicy } from './authorization.decorators.js';
import { MemberPolicy } from './policies/member.policy.js';
import { RolesPolicy } from './roles.policy.js';

const repository = { findById: vi.fn() };

@Controller()
class FakeController {
  @Patch('settings')
  @TenantScoped()
  @Roles(MemberRole.OWNER, MemberRole.MANAGER)
  settings() {
    return repository.findById('settings');
  }

  @Get('admin')
  @Roles(PLATFORM_ADMIN_ROLE)
  admin() {
    return { ok: true };
  }

  @Patch('members')
  @TenantScoped()
  @UsePolicy(MemberPolicy, 'manage')
  manage() {
    return { ok: true };
  }

  @Get('forgotten')
  forgotten() {
    return { ok: true };
  }
}

const staff = (role: MemberRole): Subject => ({
  kind: 'staff',
  userId: 'u',
  tenantId: 't',
  role,
  staffId: null,
});

describe('authorization guard wiring', () => {
  let app: INestApplication;
  let subject: Subject | null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthorizationModule.forRoot({ getUser: () => subject })],
      controllers: [FakeController],
      providers: [RolesPolicy, MemberPolicy],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => repository.findById.mockReset().mockReturnValue({}));

  const http = () => request(app.getHttpServer());

  it.each<[MemberRole, number]>([
    ['OWNER', 200],
    ['MANAGER', 200],
    ['RECEPTIONIST', 403],
    ['STAFF', 403],
  ])('RBAC: %s on an Owner/Manager route → %i', async (role, status) => {
    subject = staff(role);
    await http().patch('/settings').expect(status);
  });

  it('RBAC never loads the record before deciding', async () => {
    subject = staff(MemberRole.STAFF);
    await http().patch('/settings').expect(403);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('platform admin role: only the platform subject', async () => {
    subject = { kind: 'platform', userId: 'p' };
    await http().get('/admin').expect(200);
    for (const other of [
      staff(MemberRole.OWNER),
      { kind: 'user', userId: 'u' } as const,
      { kind: 'customer', accountId: 'c' } as const,
    ]) {
      subject = other;
      await http().get('/admin').expect(403);
    }
  });

  it('ABAC route ability: Owner/Manager reach member management', async () => {
    subject = staff(MemberRole.MANAGER);
    await http().patch('/members').expect(200);
    subject = staff(MemberRole.RECEPTIONIST);
    await http().patch('/members').expect(403);
  });

  it('denies a route that declares nothing (deny by default)', async () => {
    subject = staff(MemberRole.OWNER);
    await http().get('/forgotten').expect(403);
  });
});

describe('authorizationProblems (startup check)', () => {
  @Public()
  class OpenController {
    route() {}
  }
  @Can.Anyone()
  class MeLikeController {
    route() {}
  }
  class Routes {
    none() {}
    @Roles(PLATFORM_ADMIN_ROLE)
    admin() {}
    @TenantScoped()
    @Roles(...ANY_MEMBER)
    team() {}
    @Roles(MemberRole.OWNER)
    rolesWithoutTenant() {}
    @TenantScoped()
    tenantWithoutCheck() {}
    @TenantScoped()
    @Roles(MemberRole.OWNER)
    @UsePolicy(MemberPolicy, 'manage')
    both() {}
    @Can(RolesPolicy, 'hasRole', () => [['OWNER']] as const)
    rawCan() {}
  }

  const check = (type: new () => object, method: string): string[] =>
    authorizationProblems([
      readDeclarations(
        type,
        (type.prototype as Record<string, object>)[method],
      ) as RouteDeclarations,
    ]);

  it('accepts exactly one declaration', () => {
    expect(check(OpenController, 'route')).toEqual([]);
    expect(check(MeLikeController, 'route')).toEqual([]);
    expect(check(Routes, 'admin')).toEqual([]);
    expect(check(Routes, 'team')).toEqual([]);
  });

  it('fails a route with no authorization decorator', () => {
    expect(check(Routes, 'none')).toEqual([
      expect.stringContaining('declares no authorization'),
    ]);
  });

  it('fails a route with both @Roles and @UsePolicy', () => {
    expect(check(Routes, 'both')).toEqual([
      expect.stringContaining('@Roles() and @UsePolicy()'),
    ]);
  });

  it('fails tenant roles without @TenantScoped, and @TenantScoped alone', () => {
    expect(check(Routes, 'rolesWithoutTenant')).toEqual([
      expect.stringContaining('needs @TenantScoped()'),
    ]);
    expect(check(Routes, 'tenantWithoutCheck')).toEqual([
      expect.stringContaining('declares no authorization'),
      expect.stringContaining('needs @Roles() or @UsePolicy()'),
    ]);
  });

  it('fails a bare @Can()', () => {
    expect(check(Routes, 'rawCan')).toContainEqual(
      expect.stringContaining('bare @Can()'),
    );
  });
});
