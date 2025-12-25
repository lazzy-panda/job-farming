function uniq(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const key = v.trim();
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

export interface PostprocessTarget {
  contacts: {
    emails: string[];
    phones: string[];
    telegram: string[];
    urls: string[];
  };
}

function normalizeTechToken(value: string): string {
  const v = value.trim();
  const key = v.toLowerCase();
  const map: Record<string, string> = {
    'typescript': 'TypeScript',
    'ts': 'TypeScript',
    'javascript': 'JavaScript',
    'js': 'JavaScript',
    'node': 'Node.js',
    'nodejs': 'Node.js',
    'node.js': 'Node.js',
    'nestjs': 'NestJS',
    'nest': 'NestJS',
    'rxjs': 'RxJS',
    'angular': 'Angular',
    'react': 'React',
    'vue': 'Vue',
  };
  return map[key] ?? v;
}

function sortStrings(values: string[]): string[] {
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export function postprocessArrays<T extends PostprocessTarget>(res: T): T {
  // minimal normalization; extractor-specific normalization will come later.
  const emails = Array.isArray(res.contacts.emails) ? res.contacts.emails : [];
  const phones = Array.isArray(res.contacts.phones) ? res.contacts.phones : [];
  const telegram = Array.isArray(res.contacts.telegram) ? res.contacts.telegram : [];
  const urls = Array.isArray(res.contacts.urls) ? res.contacts.urls : [];

  res.contacts.emails = sortStrings(uniq(emails.map((e) => e.toLowerCase())));
  res.contacts.phones = sortStrings(uniq(phones));
  res.contacts.telegram = sortStrings(uniq(telegram));
  res.contacts.urls = sortStrings(uniq(urls));

  // Normalize and dedup other arrays when available on ParseResult shape.
  const anyRes = res as unknown as Record<string, unknown>;

  const employment = anyRes['employment'] as { types?: string[] } | undefined;
  if (employment?.types) {
    employment.types = sortStrings(uniq(employment.types));
  }

  const schedule = anyRes['schedule'] as { patterns?: string[] } | undefined;
  if (schedule?.patterns) {
    schedule.patterns = sortStrings(uniq(schedule.patterns));
  }

  const benefits = anyRes['benefits'] as string[] | undefined;
  if (Array.isArray(benefits)) {
    anyRes['benefits'] = sortStrings(uniq(benefits));
  }

  const interview = anyRes['interview'] as { steps?: string[] } | undefined;
  if (interview?.steps) {
    interview.steps = sortStrings(uniq(interview.steps));
  }

  const tech = anyRes['tech'] as { must?: string[]; plus?: string[]; all?: string[] } | undefined;
  if (tech) {
    const must = Array.isArray(tech.must) ? tech.must.map(normalizeTechToken) : [];
    const plus = Array.isArray(tech.plus) ? tech.plus.map(normalizeTechToken) : [];
    const all = Array.isArray(tech.all) ? tech.all.map(normalizeTechToken) : [];
    tech.must = sortStrings(uniq(must));
    tech.plus = sortStrings(uniq(plus));
    tech.all = sortStrings(uniq(all));
  }

  return res;
}
