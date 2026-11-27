import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';
import { MemberRole } from '../../generated/prisma/client.js';
import { MemberListStatus } from '../tenancy/repositories/memberships.repository.js';

/**
 * Every role is accepted here so that asking for OWNER gets a clear 422
 * OWNERSHIP_TRANSFER_REQUIRED from the service, not a generic 400.
 */
export const memberRoleSchema = z.enum(MemberRole);

const displayNameSchema = z.string().trim().min(1).max(100);

export const addMemberSchema = z.object({
  email: emailSchema,
  name: displayNameSchema,
  role: memberRoleSchema,
  /** Also give them a bookable calendar. Always true for STAFF. */
  bookable: z.boolean().optional(),
});
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z
  .object({
    role: memberRoleSchema.optional(),
    bookable: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;

export const listMembersQuerySchema = z.object({
  role: memberRoleSchema.optional(),
  /** Without it, every member who hasn't been removed. */
  status: z.enum(MemberListStatus).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const listStaffQuerySchema = z.object({
  /** `false` lists deactivated calendars instead. */
  active: z.stringbool().default(true),
});
export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;

export const updateStaffSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export type UpdateStaffDto = z.infer<typeof updateStaffSchema>;

export const idParamSchema = z.uuid();

export const transferOwnershipSchema = z
  .object({
    /** Membership id of the Manager who becomes Owner. */
    memberId: z.uuid(),
    /** The Owner's current password, re-entered. */
    password: z.string().min(1).max(200),
  })
  .strict();
export type TransferOwnershipDto = z.infer<typeof transferOwnershipSchema>;
