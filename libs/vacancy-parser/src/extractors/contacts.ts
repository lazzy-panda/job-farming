import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { DocumentContext } from '../core/document-context';
import type { DocumentLang, RuleTrace } from '../model/types';

export interface ContactsExtractResult {
  contacts: {
    emails: string[];
    phones: string[];
    telegram: string[];
    urls: string[];
  };
  confidence: number;
  warnings: string[];
  traces: RuleTrace[];
}

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

function guessDefaultCountry(lang: DocumentLang): 'RU' | undefined {
  if (lang === 'ru' || lang === 'mixed') {
    return 'RU';
  }
  return undefined;
}

function normalizeContactText(text: string): string {
  // Some sources insert invisible characters (soft hyphen / zero-width) that break regexes.
  return (text ?? '').replace(/[\u00AD\u200B\u200D\u2060\uFEFF]/g, '');
}

function extractEmails(text: string): Array<{ value: string; snippet: string }>{
  const out: Array<{ value: string; snippet: string }> = [];
  const re = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[1].toLowerCase();
    const snippet = text.slice(Math.max(0, m.index - 25), Math.min(text.length, m.index + m[1].length + 25)).replace(/\s+/g, ' ');
    out.push({ value, snippet });
  }
  return out;
}

function extractTelegram(text: string): Array<{ value: string; snippet: string }>{
  const out: Array<{ value: string; snippet: string }> = [];

  // @username
  const reAt = /(^|\s)@([a-zA-Z0-9_]{3,32})\b/g;
  let m: RegExpExecArray | null;
  while ((m = reAt.exec(text)) !== null) {
    const value = `@${m[2]}`;
    const snippet = text.slice(Math.max(0, m.index - 25), Math.min(text.length, m.index + m[0].length + 25)).replace(/\s+/g, ' ');
    out.push({ value, snippet });
  }

  // t.me/username
  const reUrl = /t\.me\/(?:joinchat\/|\+)?([a-zA-Z0-9_]{3,64})\b/gi;
  while ((m = reUrl.exec(text)) !== null) {
    const handle = m[1];
    const value = handle.startsWith('+') ? `t.me/${handle}` : `@${handle}`;
    const snippet = text.slice(Math.max(0, m.index - 25), Math.min(text.length, m.index + m[0].length + 25)).replace(/\s+/g, ' ');
    out.push({ value, snippet });
  }

  return out;
}

function extractUrls(text: string): Array<{ value: string; snippet: string }>{
  const out: Array<{ value: string; snippet: string }> = [];
  const re = /(https?:\/\/[^\s)]+)|(www\.[^\s)]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw) {
      continue;
    }
    const value = sanitizeUrl(raw.startsWith('www.') ? `https://${raw}` : raw);
    if (!value) {
      continue;
    }
    const snippet = text.slice(Math.max(0, m.index - 25), Math.min(text.length, m.index + raw.length + 25)).replace(/\s+/g, ' ');
    out.push({ value, snippet });
  }
  return out;
}

function sanitizeUrl(input: string): string | null {
  let v = input.trim();
  if (!v) {
    return null;
  }

  // Trim trailing punctuation that often sticks to URLs in Telegram/markdown.
  // e.g. "https://x.y/Marin," -> "https://x.y/Marin"
  while (/[),.;:\]]$/.test(v) || v.endsWith(',') || v.endsWith('，') || v.endsWith('、')) {
    v = v.slice(0, -1).trim();
  }

  if (!v) {
    return null;
  }
  return v;
}

function extractPhones(
  text: string,
  lang: DocumentLang,
  defaultCountryHint: string | null,
): Array<{ value: string; snippet: string }>{
  const out: Array<{ value: string; snippet: string }> = [];
  const candidates = text.match(/(\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  const hint = defaultCountryHint?.trim() ?? '';
  const defaultCountry = hint ? hint.toUpperCase() : guessDefaultCountry(lang);

  for (const raw of candidates) {
    const compact = raw.replace(/\s+/g, ' ').trim();
    const parsed = parsePhoneNumberFromString(compact, defaultCountry as never);
    if (!parsed || !parsed.isValid()) {
      continue;
    }
    const value = parsed.number; // E.164
    const idx = text.indexOf(raw);
    const snippet = idx >= 0
      ? text.slice(Math.max(0, idx - 25), Math.min(text.length, idx + raw.length + 25)).replace(/\s+/g, ' ')
      : compact;
    out.push({ value, snippet });
  }

  return out;
}

export function extractContacts(ctx: DocumentContext, enableTraces: boolean): ContactsExtractResult {
  const warnings: string[] = [];
  const traces: RuleTrace[] = [];

  const contactText = normalizeContactText(ctx.normalizedText);
  const emailsRaw = extractEmails(contactText);
  const phonesRaw = extractPhones(contactText, ctx.lang, ctx.defaultCountry);
  const telegramRaw = extractTelegram(contactText);
  const urlsRaw = extractUrls(contactText);

  if (enableTraces) {
    for (const e of emailsRaw) {
      traces.push({ extractor: 'contacts', ruleId: 'regex:email', section: 'body', snippet: e.snippet, scoreDelta: 1 });
    }
    for (const p of phonesRaw) {
      traces.push({ extractor: 'contacts', ruleId: 'regex:phone', section: 'body', snippet: p.snippet, scoreDelta: 1 });
    }
    for (const t of telegramRaw) {
      traces.push({ extractor: 'contacts', ruleId: 'regex:telegram', section: 'body', snippet: t.snippet, scoreDelta: 1 });
    }
    for (const u of urlsRaw) {
      traces.push({ extractor: 'contacts', ruleId: 'regex:url', section: 'body', snippet: u.snippet, scoreDelta: 1 });
    }
  }

  const emails = uniq(emailsRaw.map((x) => x.value));
  const phones = uniq(phonesRaw.map((x) => x.value));
  const telegram = uniq(telegramRaw.map((x) => x.value));
  const urls = uniq(urlsRaw.map((x) => x.value));

  const totalFound = emails.length + phones.length + telegram.length + urls.length;
  const confidence = totalFound === 0 ? 0 : Math.min(1, 0.35 + totalFound * 0.15);

  if (totalFound === 0) {
    warnings.push('contacts_not_found');
  }

  return {
    contacts: { emails, phones, telegram, urls },
    confidence,
    warnings,
    traces,
  };
}
