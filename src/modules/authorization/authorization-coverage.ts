import {
  Injectable,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { PLATFORM_ADMIN_ROLE } from '../../shared/context/request-context.js';
import { TENANT_SCOPED } from '../tenancy/tenant-resolver.js';
import { POLICY_METADATA, ROLES_METADATA } from './authorization.decorators.js';
import type { SubjectRole } from './roles.policy.js';

// Written by @nestjs/authentication's @Public() / @Authenticate() and by
// @nestjs/authorization's @Can() / @Can.Anyone() (registry keys, stable).
const AUTHENTICATION_PUBLIC = Symbol.for('@nestjs/authentication:public');
const CAN_METADATA = 'authorization:can';
const CAN_ANYONE_METADATA = 'authorization:can-anyone';

/** The authorization declarations of one route handler. */
export interface RouteDeclarations {
  /** `Controller.method`, for the error message. */
  route: string;
  public: boolean;
  /** `@Can.Anyone()`: any signed-in account, the service decides. */
  anyone: boolean;
  roles: readonly SubjectRole[] | undefined;
  policy: boolean;
  /** A raw `@Can()` (not through `@Roles` / `@UsePolicy`). */
  rawCan: boolean;
  tenantScoped: boolean;
}

export function readDeclarations(
  type: Type<unknown>,
  handler: object,
): RouteDeclarations {
  const get = <T>(key: string | symbol, target: object) =>
    Reflect.getMetadata(key, target) as T | undefined;
  const methodPublic = get<boolean>(AUTHENTICATION_PUBLIC, handler);
  const roles =
    get<SubjectRole[]>(ROLES_METADATA, handler) ??
    get<SubjectRole[]>(ROLES_METADATA, type);
  const policy =
    get(POLICY_METADATA, handler) !== undefined ||
    get(POLICY_METADATA, type) !== undefined;
  const can =
    (get<unknown[]>(CAN_METADATA, handler)?.length ?? 0) +
    (get<unknown[]>(CAN_METADATA, type)?.length ?? 0);
  return {
    route: `${type.name}.${(handler as { name?: string }).name ?? '?'}`,
    public:
      methodPublic === true ||
      (methodPublic === undefined &&
        get<boolean>(AUTHENTICATION_PUBLIC, type) === true),
    anyone:
      get<boolean>(CAN_ANYONE_METADATA, handler) === true ||
      get<boolean>(CAN_ANYONE_METADATA, type) === true,
    roles,
    policy,
    rawCan: can > 0 && !roles && !policy,
    tenantScoped:
      get<boolean>(TENANT_SCOPED, handler) === true ||
      get<boolean>(TENANT_SCOPED, type) === true,
  };
}

/**
 * Deny by default (F03): every route declares exactly one of `@Public()`,
 * `@Can.Anyone()`, `@Roles()` or `@UsePolicy()`; tenant roles only on
 * `@TenantScoped()` routes, and a tenant route always says who may call it.
 */
export function authorizationProblems(
  routes: readonly RouteDeclarations[],
): string[] {
  const problems: string[] = [];
  for (const r of routes) {
    const declared = [
      r.public && '@Public()',
      r.anyone && '@Can.Anyone()',
      r.roles && '@Roles()',
      r.policy && '@UsePolicy()',
    ].filter((d): d is string => !!d);

    if (r.rawCan) {
      problems.push(
        `${r.route}: use @Roles() or @UsePolicy() instead of a bare @Can()`,
      );
    }
    if (declared.length === 0) {
      problems.push(
        `${r.route}: declares no authorization (add @Public(), @Can.Anyone(), @Roles() or @UsePolicy())`,
      );
    } else if (declared.length > 1) {
      problems.push(
        `${r.route}: declares ${declared.join(' and ')}; use exactly one`,
      );
    }
    const tenantRoles = r.roles?.filter((role) => role !== PLATFORM_ADMIN_ROLE);
    if (tenantRoles?.length && !r.tenantScoped) {
      problems.push(
        `${r.route}: @Roles(${tenantRoles.join(', ')}) needs @TenantScoped()`,
      );
    }
    if (r.tenantScoped && !r.roles && !r.policy) {
      problems.push(
        `${r.route}: @TenantScoped() needs @Roles() or @UsePolicy()`,
      );
    }
  }
  return problems;
}

/** Fails startup when a route breaks `authorizationProblems()`. */
@Injectable()
export class AuthorizationCoverageCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    const problems = authorizationProblems(this.routes());
    if (problems.length > 0) {
      throw new Error(
        `Authorization is missing or ambiguous on ${problems.length} route(s):\n- ${problems.join('\n- ')}`,
      );
    }
  }

  routes(): RouteDeclarations[] {
    const routes: RouteDeclarations[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const type = wrapper.metatype as Type<unknown> | null;
      if (!type) continue;
      const proto = type.prototype as Record<string, object>;
      for (const name of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[name];
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes.push(readDeclarations(type, handler));
      }
    }
    return routes;
  }
}
