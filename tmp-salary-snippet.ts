import { readFileSync } from 'fs';
import { buildContext } from './libs/vacancy-parser/src/core/build-context';
const text = readFileSync('./libs/vacancy-parser/src/tests/fixtures/ru-telegram-021.txt', 'utf8');
const ctx = buildContext(text, {});
for (const section of ctx.sections) {
  if (section.text.includes('201-241')) {
    const idx = section.text.indexOf('201-241');
    const start = Math.max(0, idx - 40);
    const end = Math.min(section.text.length, idx + 40);
    console.log(section.text.slice(start, end));
  }
}
