import type { DocumentLang } from '../model/types';
import type { DocumentSection, DocumentSectionName } from './document-context';

interface SectionHeaderRule {
  name: DocumentSectionName;
  lang: DocumentLang;
  patterns: RegExp[];
}

const RU_HEADERS: SectionHeaderRule[] = [
  { name: 'requirements', lang: 'ru', patterns: [/^требования\b/i, /^требуемые\b/i, /^ожидания\b/i] },
  { name: 'responsibilities', lang: 'ru', patterns: [/^обязанности\b/i, /^задачи\b/i, /^что делать\b/i] },
  { name: 'benefits', lang: 'ru', patterns: [/^условия\b/i, /^мы предлагаем\b/i, /^бонусы\b/i] },
  { name: 'contacts', lang: 'ru', patterns: [/^контакты\b/i, /^как откликнуться\b/i] },
  { name: 'about', lang: 'ru', patterns: [/^о компании\b/i, /^о нас\b/i] },
  { name: 'nice_to_have', lang: 'ru', patterns: [/^будет плюсом\b/i, /^плюсом будет\b/i, /^желательно\b/i] },
];

const EN_HEADERS: SectionHeaderRule[] = [
  { name: 'requirements', lang: 'en', patterns: [/^requirements\b/i, /^you have\b/i, /^your profile\b/i, /^what we are looking for\b/i, /^skills\b/i] },
  { name: 'responsibilities', lang: 'en', patterns: [/^responsibilities\b/i, /^what you will do\b/i, /^what you['’]ll do\b/i, /^your responsibilities\b/i, /^the role\b/i, /^what you will be doing\b/i] },
  { name: 'benefits', lang: 'en', patterns: [/^benefits\b/i, /^we offer\b/i, /^what we offer\b/i, /^compensation\b/i, /^perks\b/i, /^why join\b/i] },
  { name: 'contacts', lang: 'en', patterns: [/^contacts\b/i, /^how to apply\b/i, /^apply\b/i, /^apply now\b/i, /^contact\b/i] },
  { name: 'about', lang: 'en', patterns: [/^about\b/i, /^about us\b/i, /^company\b/i, /^who we are\b/i] },
  { name: 'nice_to_have', lang: 'en', patterns: [/^nice to have\b/i, /^optional\b/i, /^preferred\b/i, /^plus\b/i] },
];

// Minimal multi-language section headers (best-effort). We keep lang as 'unknown' to avoid lying.
const GLOBAL_HEADERS: SectionHeaderRule[] = [
  // DE
  { name: 'requirements', lang: 'unknown', patterns: [/^anforderungen\b/i, /^qualifikationen\b/i, /^profil\b/i] },
  { name: 'responsibilities', lang: 'unknown', patterns: [/^aufgaben\b/i, /^verantwortlichkeiten\b/i] },
  { name: 'benefits', lang: 'unknown', patterns: [/^wir bieten\b/i, /^benefits\b/i, /^angebot\b/i] },
  { name: 'contacts', lang: 'unknown', patterns: [/^kontakt\b/i, /^bewerbung\b/i, /^bewerben\b/i] },
  { name: 'about', lang: 'unknown', patterns: [/^über uns\b/i, /^unternehmen\b/i] },
  { name: 'nice_to_have', lang: 'unknown', patterns: [/^von vorteil\b/i, /^wünschenswert\b/i] },

  // FR
  { name: 'requirements', lang: 'unknown', patterns: [/^exigences\b/i, /^profil\b/i, /^compétences\b/i] },
  { name: 'responsibilities', lang: 'unknown', patterns: [/^responsabilités\b/i, /^missions\b/i] },
  { name: 'benefits', lang: 'unknown', patterns: [/^avantages\b/i, /^nous offrons\b/i] },
  { name: 'contacts', lang: 'unknown', patterns: [/^contact\b/i, /^candidature\b/i, /^postuler\b/i] },
  { name: 'about', lang: 'unknown', patterns: [/^à propos\b/i, /^à propos de nous\b/i] },
  { name: 'nice_to_have', lang: 'unknown', patterns: [/^souhaité\b/i, /^optionnel\b/i, /^atout\b/i] },

  // ES
  { name: 'requirements', lang: 'unknown', patterns: [/^requisitos\b/i, /^perfil\b/i] },
  { name: 'responsibilities', lang: 'unknown', patterns: [/^responsabilidades\b/i, /^tareas\b/i] },
  { name: 'benefits', lang: 'unknown', patterns: [/^ofrecemos\b/i, /^beneficios\b/i] },
  { name: 'contacts', lang: 'unknown', patterns: [/^contacto\b/i, /^cómo aplicar\b/i, /^aplicar\b/i] },
  { name: 'about', lang: 'unknown', patterns: [/^sobre nosotros\b/i, /^empresa\b/i] },
  { name: 'nice_to_have', lang: 'unknown', patterns: [/^deseable\b/i, /^se valora\b/i] },

  // IT
  { name: 'requirements', lang: 'unknown', patterns: [/^requisiti\b/i, /^profilo\b/i] },
  { name: 'responsibilities', lang: 'unknown', patterns: [/^responsabilità\b/i, /^mansioni\b/i] },
  { name: 'benefits', lang: 'unknown', patterns: [/^offriamo\b/i, /^benefici\b/i] },
  { name: 'contacts', lang: 'unknown', patterns: [/^contatti\b/i, /^candidati\b/i, /^candidatura\b/i] },
  { name: 'about', lang: 'unknown', patterns: [/^chi siamo\b/i, /^azienda\b/i] },
  { name: 'nice_to_have', lang: 'unknown', patterns: [/^preferibile\b/i, /^plus\b/i] },

  // PT
  { name: 'requirements', lang: 'unknown', patterns: [/^requisitos\b/i, /^perfil\b/i] },
  { name: 'responsibilities', lang: 'unknown', patterns: [/^responsabilidades\b/i, /^atribuições\b/i] },
  { name: 'benefits', lang: 'unknown', patterns: [/^oferecemos\b/i, /^benefícios\b/i] },
  { name: 'contacts', lang: 'unknown', patterns: [/^contato\b/i, /^candidatar\b/i] },
  { name: 'about', lang: 'unknown', patterns: [/^sobre nós\b/i, /^empresa\b/i] },
  { name: 'nice_to_have', lang: 'unknown', patterns: [/^desejável\b/i] },
];

function matchHeaderRule(value: string, rules: SectionHeaderRule[]): SectionHeaderRule | null {
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(value)) {
        return rule;
      }
    }
  }
  return null;
}

function isHeaderLine(
  line: string,
  rules: SectionHeaderRule[],
): { rule: SectionHeaderRule; remainder: string } | null {
  const raw = line.trim();
  if (!raw) {
    return null;
  }

  // Support inline headers like "Nice to have: German B1"
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const head = raw.slice(0, colonIdx).trim();
    const remainder = raw.slice(colonIdx + 1).trim();
    const rule = matchHeaderRule(head, rules);
    if (rule) {
      return { rule, remainder };
    }
  }

  // Fallback: pure header line like "Requirements:" / "Требования"
  const value = raw.replace(/[:\-]+\s*$/, '');
  const rule = matchHeaderRule(value, rules);
  if (!rule) {
    return null;
  }
  return { rule, remainder: '' };
}

function pushSection(out: DocumentSection[], name: DocumentSectionName, lang: DocumentLang, lines: string[]): void {
  const text = lines.join('\n').trim();
  if (!text) {
    return;
  }
  out.push({ name, lang, lines, text });
}

export function segment(lines: string[], docLang: DocumentLang): DocumentSection[] {
  const sections: DocumentSection[] = [];

  // head = first 10 non-empty lines
  const headLines = lines.slice(0, 10);
  pushSection(sections, 'head', docLang, headLines);

  // Important: section headers may appear in the first lines as well.
  // We keep headLines separately, but still scan ALL lines for sections.
  const scanLines = lines;
  if (scanLines.length === 0) {
    return sections;
  }

  const rules: SectionHeaderRule[] = [...RU_HEADERS, ...EN_HEADERS, ...GLOBAL_HEADERS];

  let currentName: DocumentSectionName = 'body';
  let currentLang: DocumentLang = docLang;
  let buffer: string[] = [];

  for (const line of scanLines) {
    const header = isHeaderLine(line, rules);
    if (header) {
      pushSection(sections, currentName, currentLang, buffer);
      buffer = [];
      currentName = header.rule.name;
      currentLang = header.rule.lang;
      if (header.remainder) {
        buffer.push(header.remainder);
      }
      continue;
    }
    buffer.push(line);
  }

  pushSection(sections, currentName, currentLang, buffer);

  return sections;
}
