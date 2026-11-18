import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  passwordSchema,
  phoneSchema,
  updateProfileSchema,
} from '@/lib/validation';
import { endOfMonth } from '@/app/api/admin/audience/route';

describe('input validation', () => {
  it('normalises email to lowercase and trims it', () => {
    expect(emailSchema.parse('  Reader@SkyUp.COM ')).toBe('reader@skyup.com');
  });

  it('rejects malformed email', () => {
    expect(() => emailSchema.parse('not-an-email')).toThrow();
  });

  it('requires a password of at least ten characters', () => {
    expect(() => passwordSchema.parse('short')).toThrow();
    expect(passwordSchema.parse('long-enough-passphrase')).toBeTruthy();
  });

  it('accepts E.164 phone numbers only', () => {
    expect(phoneSchema.parse('+919876543210')).toBe('+919876543210');
    expect(() => phoneSchema.parse('9876543210')).toThrow();
    expect(() => phoneSchema.parse('+0123')).toThrow();
  });

  it('refuses an empty profile patch rather than reporting a no-op success', () => {
    expect(() => updateProfileSchema.parse({})).toThrow();
  });

  it('REJECTS a data: URI as an avatar URL — uploads have their own endpoint', () => {
    expect(() =>
      updateProfileSchema.parse({ avatarUrl: 'data:image/svg+xml;utf8,<svg/>' }),
    ).toThrow();
    expect(
      updateProfileSchema.parse({ avatarUrl: 'https://cdn.example.com/a.png' }),
    ).toBeTruthy();
  });
});

describe('month boundary for the expiring filter', () => {
  it('lands on the last day of the month, not the first of the next', () => {
    const end = endOfMonth(new Date(2026, 8, 11)); // September
    expect(end.getMonth()).toBe(8);
    expect(end.getDate()).toBe(30);
  });

  it('handles February in a leap year', () => {
    expect(endOfMonth(new Date(2028, 1, 5)).getDate()).toBe(29);
  });

  it('handles February in a common year', () => {
    expect(endOfMonth(new Date(2027, 1, 5)).getDate()).toBe(28);
  });

  it('handles December without rolling the year backwards', () => {
    const end = endOfMonth(new Date(2026, 11, 15));
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });
});
