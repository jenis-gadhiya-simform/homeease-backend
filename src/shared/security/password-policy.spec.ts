import { passwordSchema } from './password-policy.js';

describe('passwordSchema', () => {
  it('accepts a long, uncommon password', () => {
    expect(passwordSchema.safeParse('correct horse battery').success).toBe(
      true,
    );
  });

  it('rejects passwords under 10 characters', () => {
    const result = passwordSchema.safeParse('short1!');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/at least 10/);
  });

  it.each(['password123', 'Password123', 'QWERTYUIOP'])(
    'rejects the breached password %s',
    (value) => {
      const result = passwordSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/Too common/);
    },
  );
});
