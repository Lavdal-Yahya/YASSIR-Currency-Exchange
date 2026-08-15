/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import fr from './locales/fr.json';

// Parity: every key in `ar` exists in `fr` and vice versa. A key present
// in one language only fails the test with the offending path — this is
// the enforcement point for "new strings land in ar and fr in the same
// commit" (conventions §4).
//
// Parity alone is symmetric, so it stayed green while whole namespaces were
// missing from *both* files and the UI rendered raw keys ("expenses.title").
// The last two suites close that gap: every key the source actually asks for
// must resolve to a string, and every plural key must carry the forms its
// language needs — Arabic without `_few`/`_many` falls through to
// fallbackLng and prints French on an Arabic screen.

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

// i18next appends a CLDR category to the key when `count` is passed, so
// `foo_one` and `foo_few` are one logical key. Compare bases, not leaves —
// the two languages legitimately need different category sets.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function pluralBase(key: string): string {
  return key.replace(PLURAL_SUFFIX, '');
}

function lookup(obj: Nested, path: string): string | Nested | undefined {
  let node: string | Nested | undefined = obj;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return node;
}

// The categories a language actually uses for the counts this app produces.
// Deriving them from Intl rather than hard-coding keeps the test honest, and
// sampling a realistic range avoids demanding French `_many`, which CLDR only
// selects at 1,000,000+.
function requiredCategories(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const seen = new Set<string>();
  for (let n = 0; n <= 200; n++) seen.add(rules.select(n));
  return [...seen].sort();
}

const LOCALES: [string, Nested][] = [
  ['fr', fr as Nested],
  ['ar', ar as Nested],
];

describe('i18n parity', () => {
  const frKeys = collectKeys(fr as Nested);
  const arKeys = collectKeys(ar as Nested);
  const frBases = new Set(frKeys.map(pluralBase));
  const arBases = new Set(arKeys.map(pluralBase));

  it('every fr key exists in ar', () => {
    const missing = [...frBases].filter((k) => !arBases.has(k)).sort();
    expect(missing, `keys missing from ar: ${missing.join(', ')}`).toEqual([]);
  });

  it('every ar key exists in fr', () => {
    const missing = [...arBases].filter((k) => !frBases.has(k)).sort();
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

describe('i18n plural coverage', () => {
  it.each(LOCALES)('%s defines every plural form its counts select', (locale, bundle) => {
    const needed = requiredCategories(locale);
    const bases = new Set(
      collectKeys(bundle)
        .filter((k) => PLURAL_SUFFIX.test(k))
        .map(pluralBase),
    );

    const gaps: string[] = [];
    for (const base of [...bases].sort()) {
      const missing = needed.filter((cat) => typeof lookup(bundle, `${base}_${cat}`) !== 'string');
      if (missing.length > 0) gaps.push(`${base} (missing ${missing.join(', ')})`);
    }
    expect(gaps, `incomplete plurals in ${locale}: ${gaps.join('; ')}`).toEqual([]);
  });
});

describe('i18n key usage', () => {
  // Vite inlines these at transform time, so the test reads the real source
  // without touching the filesystem.
  const sources = import.meta.glob('../../**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  // Only static keys can be checked. `t(\`payments.direction_${dir}\`)` and
  // friends are invisible here and rely on a defaultValue instead.
  const PATTERNS = [
    /\bt\(\s*'([a-zA-Z0-9_.]+)'/g, // t('some.key')
    /\bmessage:\s*'([a-zA-Z0-9_.]+\.[a-zA-Z0-9_.]+)'/g, // zod: message: 'some.key'
  ];

  const used = new Map<string, string>(); // key -> first file that asks for it
  for (const [file, source] of Object.entries(sources)) {
    if (file.includes('.test.')) continue;
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const key = match[1];
        if (key && !used.has(key)) used.set(key, file);
      }
    }
  }

  it('finds keys to check', () => {
    expect(used.size).toBeGreaterThan(50);
  });

  it.each(LOCALES)('%s resolves every key the source asks for', (locale, bundle) => {
    const broken: string[] = [];
    for (const [key, file] of used) {
      const value = lookup(bundle, key);
      if (typeof value === 'string') continue;
      // A plural key has no bare entry — any category standing in is enough,
      // since the plural-coverage suite above checks the rest.
      const hasPlural = requiredCategories(locale).some(
        (cat) => typeof lookup(bundle, `${key}_${cat}`) === 'string',
      );
      if (hasPlural) continue;
      broken.push(`${key} (${value === undefined ? 'missing' : 'not a string'}) <- ${file}`);
    }
    expect(broken, `unresolvable keys in ${locale}:\n  ${broken.join('\n  ')}`).toEqual([]);
  });
});
