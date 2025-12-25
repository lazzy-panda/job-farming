const HEAD_LINES_COUNT = 10;

function decodeBasicEntities(text: string): string {
  // minimal decode to keep lib dependency-free
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(text: string): string {
  const withNewlines = text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/?p\s*>/gi, '\n')
    .replace(/<\s*\/?div\s*>/gi, '\n')
    .replace(/<\s*\/?li\s*>/gi, '\n- ')
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?<\s*\/\s*style\s*>/gi, '');

  const noTags = withNewlines.replace(/<[^>]+>/g, ' ');
  return decodeBasicEntities(noTags);
}

function normalizeDashes(text: string): string {
  return text.replace(/[–—]/g, '-');
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface PreprocessResult {
  normalizedText: string;
  lines: string[];
  headLines: string[];
}

export function preprocess(rawText: string): PreprocessResult {
  const stripped = stripHtml(rawText ?? '');
  const dashed = normalizeDashes(stripped);
  const normalizedText = normalizeWhitespace(dashed);
  const lines = toLines(normalizedText);
  const headLines = lines.slice(0, HEAD_LINES_COUNT);

  return { normalizedText, lines, headLines };
}
