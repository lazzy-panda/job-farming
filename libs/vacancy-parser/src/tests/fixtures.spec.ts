import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseVacancy } from '../index';

function normalizeForSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const obj = value as Record<string, unknown>;
  if (obj['meta'] && typeof obj['meta'] === 'object') {
    const meta = obj['meta'] as Record<string, unknown>;
    meta['timingMs'] = 0;
  }
  return value;
}

describe('fixtures -> expected', () => {
  const fixturesDir = join(__dirname, 'fixtures');
  const expectedDir = join(__dirname, 'expected');

  const fixtures = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.txt'))
    .sort();

  for (const fileName of fixtures) {
    it(fileName, () => {
      const text = readFileSync(join(fixturesDir, fileName), 'utf8');
      const actual = parseVacancy(text, {
        strict: true,
        ...inferFixtureOptions(fileName),
      });
      const normalized = normalizeForSnapshot(actual);

      const expectedPath = join(expectedDir, fileName.replace(/\.txt$/i, '.json'));
      const expectedRaw = readFileSync(expectedPath, 'utf8');
      const expected = JSON.parse(expectedRaw) as unknown;

      expect(normalized).toEqual(expected);
    });
  }
});

function inferFixtureOptions(fileName: string): Record<string, unknown> {
  const lower = fileName.toLowerCase();
  const out: Record<string, unknown> = {};

  if (lower.includes('-us-')) {
    out['defaultCountry'] = 'US';
    out['currencyHint'] = 'USD';
  } else if (lower.includes('-gb-') || lower.includes('-uk-')) {
    out['defaultCountry'] = 'GB';
    out['currencyHint'] = 'GBP';
  } else if (lower.includes('-ch-')) {
    out['defaultCountry'] = 'CH';
    out['currencyHint'] = 'CHF';
  } else if (lower.includes('-se-')) {
    out['defaultCountry'] = 'SE';
    out['currencyHint'] = 'SEK';
  } else if (lower.includes('-no-')) {
    out['defaultCountry'] = 'NO';
    out['currencyHint'] = 'NOK';
  } else if (lower.includes('-dk-')) {
    out['defaultCountry'] = 'DK';
    out['currencyHint'] = 'DKK';
  } else if (lower.includes('-gr-')) {
    out['defaultCountry'] = 'GR';
    out['currencyHint'] = 'EUR';
  } else if (lower.includes('-cy-')) {
    out['defaultCountry'] = 'CY';
    out['currencyHint'] = 'EUR';
  } else if (lower.includes('-eu-') || lower.includes('-de-') || lower.includes('-fr-') || lower.includes('-nl-')) {
    out['currencyHint'] = 'EUR';
  }

  return out;
}
