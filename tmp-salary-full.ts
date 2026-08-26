import { readFileSync } from 'fs';
import { parseVacancy } from './libs/vacancy-parser/src/parse-vacancy';
const text = readFileSync('./libs/vacancy-parser/src/tests/fixtures/ru-telegram-021.txt', 'utf8');
const res = parseVacancy(text, { strict: false });
console.log(JSON.stringify(res.salary, null, 2));
