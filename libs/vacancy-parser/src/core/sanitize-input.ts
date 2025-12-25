export interface SanitizeInputResult {
  text: string;
  warnings: string[];
}

function findFirstIndex(text: string, patterns: RegExp[]): { index: number; ruleId: string } | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m && m.index !== undefined) {
      return { index: m.index, ruleId: p.source };
    }
  }
  return null;
}

export function sanitizeInputText(rawText: string): SanitizeInputResult {
  const warnings: string[] = [];
  let text = rawText ?? '';

  // Scrapers sometimes include invisible separators (ZWJ/ZWS/WORD JOINER/BOM).
  // Converting them to newlines improves segmentation and prevents glued titles.
  const sepRe = /[\u200D\u200B\u2060\uFEFF]/g;
  if (sepRe.test(text)) {
    text = text.replace(sepRe, '\n');
    warnings.push('input_separator_normalized');
  }

  // Fix common Latin->Cyrillic lookalike typos inside Russian words (e.g., "Cоздание").
  // Do this BEFORE splitting Latin/Cyrillic boundaries, otherwise a lone "C" may be treated as tech token.
  const confusableMap: Record<string, string> = {
    A: 'А', a: 'а',
    B: 'В', b: 'в',
    C: 'С', c: 'с',
    E: 'Е', e: 'е',
    H: 'Н', h: 'н',
    K: 'К', k: 'к',
    M: 'М', m: 'м',
    O: 'О', o: 'о',
    P: 'Р', p: 'р',
    T: 'Т', t: 'т',
    X: 'Х', x: 'х',
    Y: 'У', y: 'у',
  };
  // Apply only when a single Latin lookalike starts a Cyrillic word (next char is lowercase Cyrillic),
  // to avoid breaking currency codes like "RUBБез..." where the last "B" is part of the code.
  text = text.replace(
    /(^|[^A-Za-zА-Яа-яЁё])([ABCEHKMOPTXYabcehkmoptxy])(?=[а-яё])/g,
    (_m, prefix: string, ch: string) => `${prefix}${confusableMap[ch] ?? ch}`,
  );

  // Some sources lose spaces/newlines between blocks, producing glued words like "роликовС 2013".
  // We fix the most typical glue patterns without reformatting the whole text.
  // Cyrillic: insert space between lower->UPPER boundaries.
  text = text.replace(/([а-яё])([А-ЯЁ])/g, '$1 $2');
  // Script boundary: Cyrillic -> Latin (often "дизайнерProduct")
  text = text.replace(/([\p{Script=Cyrillic}])([A-Z])/gu, '$1 $2');
  // Script boundary: Latin -> Cyrillic (often "DesignerС", "Productдизайнер")
  text = text.replace(/([A-Za-z])([\p{Script=Cyrillic}])/gu, '$1 $2');
  // Common glue: "...дизайнерот 1 500" -> "...дизайнер от 1 500"
  text = text.replace(/([\p{Script=Cyrillic}])от(\s+\d)/gu, '$1 от$2');
  // Insert space between title and glued salary chunk, but avoid breaking emails, URLs and tokens like "B2B", "3D", "C4D".
  // Example: "веб-дизайнер90 000 RUB" -> "веб-дизайнер 90 000 RUB"
  text = text.replace(
    /([A-Za-zА-Яа-яЁё])(\d{2,3}(?:[ \t.,'’]\d{3})+\s*(?:₽|RUB|USD|EUR|GBP|CHF|\$|€|£))/g,
    '$1 $2',
  );
  // Similar glue but currency can be absent or appear later: "HR-менеджер60 000 – 120 000 RURОбязанности:"
  // We split only when the number is clearly a salary-like amount with thousand groups.
  text = text.replace(
    /([A-Za-zА-Яа-яЁё])(\d{1,3}(?:[ \t.,'’]\d{3})+(?:\s*(?:[-–—]|to)\s*\d{1,3}(?:[ \t.,'’]\d{3})+)?)/g,
    '$1 $2',
  );
  // Fix a common glued pattern for company mention: "AI-креаторв Cacao" -> "AI-креатор в Cacao"
  text = text.replace(/(-[\p{Script=Cyrillic}]{3,})в(\s+[A-ZА-ЯЁ])/gu, '$1 в$2');
  // Insert newline after punctuation if next token starts a new sentence/section.
  text = text.replace(/([.!?])([А-ЯЁ])/g, '$1\n$2');
  text = text.replace(/([)\]])([А-ЯЁ])/g, '$1\n$2');

  // Split "multi-vacancy" bullet lists when dashes are glued to previous tokens.
  // Examples:
  // - "Две вакансии:— UI/UX Designer..." -> "Две вакансии:\n— UI/UX Designer..."
  // - "... @anna_recruiter05— Frontend ..." -> "... @anna_recruiter05\n— Frontend ..."
  text = text.replace(/(:)\s*([\-–—])\s*(?=\S)/g, '$1\n$2 ');
  text = text.replace(/(@[A-Za-z0-9_]{3,})\s*([\-–—])\s*(?=\S)/g, '$1\n$2 ');

  // Insert newlines before common section headers when they are glued to previous text.
  // Example: "...рынке.Что нам важно:" -> "...рынке.\nЧто нам важно:"
  const headerWords = [
    'Что нам важно',
    'Что предстоит делать',
    'Мы предлагаем',
    'Задача',
    'Задачи',
    'Требования',
    'Обязанности',
    'Условия',
    'Контакты',
    'Как откликнуться',
    'Откликнуться',
    'Кто мы',
    'Кого мы ищем',
    'Кого мы ищем и почему',
    'Чем вы будете заниматься',
    'Ключевые навыки',
    'Хотите к нам',
    'О нас',
    'О позиции',
    'Responsibilities',
    'Requirements',
    'Benefits',
    'How to apply',
    'Apply',
  ];
  const headerRe = new RegExp(`([^\\n])((?:${headerWords.map((w) => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})\\s*[:\\-])`, 'g');
  text = text.replace(headerRe, '$1\n$2');

  const dashBulletCount = (text.match(/(?:^|\n)\s*[\-–—]\s+\S/g) ?? []).length;
  if (
    /(?:^|\s)(?:две|2|two|several|multiple)\s+(?:ваканси|vacanc)/i.test(text) ||
    (/\bvacanc(?:y|ies)\b|ваканси/i.test(text) && dashBulletCount >= 2)
  ) {
    warnings.push('multi_vacancy_post');
  }

  // Cut obvious navigation/footer blocks.
  const footerPatterns: RegExp[] = [
    /понравились\s+вакансии\?/i,
    /-{3,}\s*разместить\s+вакансию/i,
    /разместить\s+вакансию/i,
  ];
  const footerHit = findFirstIndex(text, footerPatterns);
  if (footerHit && footerHit.index > 200) {
    text = text.slice(0, footerHit.index).trim();
    warnings.push('input_truncated');
  }

  return { text, warnings };
}
