import {
  createTenantSchema,
  phoneSchema,
  slugSchema,
  updateTenantSchema,
} from './tenancy.schemas.js';

describe('tenancy schemas', () => {
  it.each(['glow-salon', 'abc', 'a1-b2-c3', 'x'.repeat(40)])(
    'accepts the slug %s',
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(true);
    },
  );

  it.each([
    'ab',
    'x'.repeat(41),
    'Glow',
    'glow salon',
    'glow_salon',
    'admin',
    'api',
    'www',
  ])('rejects the slug %s', (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it('accepts Indian E.164 phone numbers only', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true);
    for (const phone of [
      '9876543210',
      '+91 98765 43210',
      '+14155550100',
      '+915876543210',
    ]) {
      expect(phoneSchema.safeParse(phone).success).toBe(false);
    }
  });

  it('lowercases the owner email', () => {
    const parsed = createTenantSchema.parse({
      name: 'Glow Salon',
      slug: 'glow-salon',
      owner: { email: 'Owner@Glow.Example', name: 'Asha' },
    });
    expect(parsed.owner.email).toBe('owner@glow.example');
  });

  it('allows no timezone, currency or locale on update, and needs a field', () => {
    expect(
      updateTenantSchema.safeParse({ timezone: 'Asia/Kolkata' }).success,
    ).toBe(false);
    expect(updateTenantSchema.safeParse({ currency: 'USD' }).success).toBe(
      false,
    );
    expect(updateTenantSchema.safeParse({}).success).toBe(false);
    expect(updateTenantSchema.safeParse({ phone: null }).success).toBe(true);
  });
});
