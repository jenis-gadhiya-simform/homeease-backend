import { z } from 'zod';
import { emailSchema } from '../auth/auth.schemas.js';
import { TenantStatus } from '../../generated/prisma/client.js';

/** Slugs that would clash with app routes or look official. */
export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'www',
  'app',
  'auth',
  'public',
  'static',
  'assets',
  'docs',
  'help',
  'support',
  'slotwise',
]);

export const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9-]{3,40}$/,
    '3–40 characters: lowercase letters, digits and hyphens',
  )
  .refine((slug) => !RESERVED_SLUGS.has(slug), 'This slug is reserved');

/** India only (E.164): +91 and a 10-digit number starting with 6–9. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^\+91[6-9]\d{9}$/,
    'An Indian number in E.164 form, e.g. +919876543210',
  );

const nameSchema = z.string().trim().min(2).max(100);
const optionalText = (max: number) => z.string().trim().min(1).max(max);

export const ownerSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100),
});
export type OwnerDto = z.infer<typeof ownerSchema>;

export const createTenantSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
  phone: phoneSchema.optional(),
  city: optionalText(100).optional(),
  address: optionalText(300).optional(),
  owner: ownerSchema,
});
export type CreateTenantDto = z.infer<typeof createTenantSchema>;

/** No timezone, currency or locale: SlotWise is India-only, INR-only, UTC. */
export const updateTenantSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    city: optionalText(100).nullable().optional(),
    address: optionalText(300).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;

export const tenantIdParamSchema = z.uuid();

export const listTenantsQuerySchema = z.object({
  status: z.enum(TenantStatus).optional(),
  /** The `nextCursor` of the previous page. */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;
