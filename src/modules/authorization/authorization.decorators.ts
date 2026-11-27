import { applyDecorators, SetMetadata, type Type } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { MemberRole } from '../../generated/prisma/client.js';
import { RolesPolicy, type SubjectRole } from './roles.policy.js';

/** Metadata read by the startup coverage check (`authorization-coverage.ts`). */
export const ROLES_METADATA = 'slotwise:authz:roles';
export const POLICY_METADATA = 'slotwise:authz:policy';

/** Every tenant role: read-only routes open to the whole team. */
export const ANY_MEMBER: readonly MemberRole[] = Object.values(MemberRole);

/**
 * RBAC route (F03): only these roles may call it, whatever record is
 * involved. Tenant roles need `@TenantScoped()` on the route too (the role
 * is the one in the business the request acts in).
 *
 * ```ts
 * @TenantScoped()
 * @Roles(MemberRole.OWNER, MemberRole.MANAGER)
 * ```
 *
 * Wrong role → 403 `FORBIDDEN`.
 */
export const Roles = (...roles: SubjectRole[]) =>
  applyDecorators(
    SetMetadata(ROLES_METADATA, roles),
    Can(RolesPolicy, 'hasRole', () => [roles] as const),
  );

type CanParams<P, A extends string> = Parameters<typeof Can<P, A>>;

/**
 * ABAC route (F03): the policy decides from the record and the situation.
 * The guard runs the policy's route ability with the subject only (e.g. "may
 * this subject manage members at all?"); the service loads the record and
 * enforces the record rule with its stable error code.
 *
 * ```ts
 * @TenantScoped()
 * @UsePolicy(MemberPolicy, 'manage')
 * ```
 *
 * Arguments are those of `@Can()` from `@nestjs/authorization`, type-checked
 * against the policy.
 */
export function UsePolicy<P, const A extends string>(
  ...params: CanParams<P, A>
) {
  const [policy, ability] = params as unknown as [Type<P>, string];
  return applyDecorators(
    SetMetadata(POLICY_METADATA, { policy: policy.name, ability }),
    (Can as (...args: unknown[]) => ClassDecorator & MethodDecorator)(
      ...params,
    ),
  );
}
