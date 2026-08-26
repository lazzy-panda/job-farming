import { readFileSync } from 'fs';
import { buildContext } from './libs/vacancy-parser/src/core/build-context';

const text = readFileSync('./libs/vacancy-parser/src/tests/fixtures/ru-telegram-021.txt', 'utf8');
const ctx = buildContext(text, {});
console.log(ctx.normalizedText.includes('TypeScript'));
console.log(ctx.normalizedText.includes('Type Script'));
