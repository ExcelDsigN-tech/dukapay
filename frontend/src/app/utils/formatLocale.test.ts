/**
 * Tests for the shared locale-aware formatting utilities (issue #536).
 *
 * Verifies that formatCurrency and formatDate produce locale-appropriate
 * output for the three supported locales (en, es, tl) and that invalid
 * locale tags fall back to en-US without throwing.
 */
import { formatCurrency, formatDate, formatNumber } from './formatLocale';

describe('formatCurrency (#536)', () => {
  it('formats correctly in en-US (default)', () => {
    const result = formatCurrency(1234.5);
    // en-US: "$1,234.50"
    expect(result).toContain('1,234');
    expect(result).toContain('50');
    // USD symbol or code present
    expect(result.match(/\$|USD/)).not.toBeNull();
  });

  it('formats correctly for es locale', () => {
    const result = formatCurrency(1234.5, 'es');
    // Spanish uses period as thousands separator, comma as decimal in most
    // es variants — the key assertion is that the numeric value is present.
    expect(result).toMatch(/1[\s.,]?234/);
    // Should contain USD currency indicator
    expect(result).toMatch(/US\$|USD|\$/);
  });

  it('formats correctly for tl (Tagalog) locale', () => {
    const result = formatCurrency(1234.5, 'tl');
    expect(result).toMatch(/1[,.]?234/);
  });

  it('falls back to en-US for an unsupported locale tag', () => {
    // Should not throw — resolveLocale catches invalid tags
    expect(() => formatCurrency(100, 'zz-INVALID')).not.toThrow();
    const fallback = formatCurrency(100, 'zz-INVALID');
    const enUS = formatCurrency(100, 'en-US');
    expect(fallback).toBe(enUS);
  });

  it('formats zero correctly', () => {
    expect(formatCurrency(0, 'en-US')).toContain('0');
  });

  it('formats negative values correctly', () => {
    const result = formatCurrency(-50, 'en-US');
    expect(result).toContain('50');
    // Negative sign or parentheses
    expect(result).toMatch(/-|−|\(/);
  });
});

describe('formatDate (#536)', () => {
  const ISO = '2024-03-15T00:00:00.000Z';

  it('formats in en-US (default)', () => {
    const result = formatDate(ISO);
    // "Mar 15, 2024" or similar
    expect(result).toContain('2024');
    expect(result).toMatch(/Mar|15/);
  });

  it('formats in es locale', () => {
    const result = formatDate(ISO, 'es');
    expect(result).toContain('2024');
    // Spanish month abbreviation for March: "mar."
    expect(result).toMatch(/mar/i);
  });

  it('formats in tl locale', () => {
    const result = formatDate(ISO, 'tl');
    expect(result).toContain('2024');
  });

  it('falls back to en-US for an invalid locale', () => {
    expect(() => formatDate(ISO, 'zz-INVALID')).not.toThrow();
    const fallback = formatDate(ISO, 'zz-INVALID');
    const enUS = formatDate(ISO, 'en-US');
    expect(fallback).toBe(enUS);
  });
});

describe('formatNumber (#536)', () => {
  it('applies locale-specific grouping', () => {
    // en-US uses comma as thousands separator
    expect(formatNumber(1000000, 'en-US')).toContain('1,000,000');
  });

  it('falls back gracefully', () => {
    expect(() => formatNumber(999, 'not-a-locale')).not.toThrow();
  });
});
