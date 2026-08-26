import { readFileSync } from 'fs';
import { buildContext } from './libs/vacancy-parser/src/core/build-context';
const text = readFileSync('./libs/vacancy-parser/src/tests/fixtures/ru-telegram-021.txt', 'utf8');
const ctx = buildContext(text, {});
for (const section of ctx.sections) {
  if (section.text.includes('Type')) {
    console.log(JSON.stringify(section.text));
  }
}
