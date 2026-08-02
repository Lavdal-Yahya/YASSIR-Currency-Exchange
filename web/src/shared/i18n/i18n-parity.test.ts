import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import fr from './locales/fr.json';

// Parity: every key in `ar` exists in `fr` and vice versa. A key present
// in one language only fails the test with the offending path — this is
// the enforcement point for "new strings land in ar and fr in the same
// commit" (conventions §4).

type Nested = { [key: string]: string | Nested };

function collectKeys(obj: Nested, prefix = ''): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.push(path);
    } else {
      out.push(...collectKeys(value, path));
    }
  }
  return out.sort();
}

describe('i18n parity', () => {
  const frKeys = collectKeys(fr as Nested);
  const arKeys = collectKeys(ar as Nested);

  it('every fr key exists in ar', () => {
    const missing = frKeys.filter((k) => !arKeys.includes(k));
    expect(missing, `keys missing from ar: ${missing.join(', ')}`).toEqual([]);
  });

  it('every ar key exists in fr', () => {
    const missing = arKeys.filter((k) => !frKeys.includes(k));
    expect(missing, `keys missing from fr: ${missing.join(', ')}`).toEqual([]);
  });

  it('no string is empty in either language', () => {
    function empties(obj: Nested, prefix = ''): string[] {
      const out: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
          if (value.trim() === '') out.push(path);
        } else {
          out.push(...empties(value, path));
        }
      }
      return out;
    }
    expect(empties(fr as Nested)).toEqual([]);
    expect(empties(ar as Nested)).toEqual([]);
  });
});
