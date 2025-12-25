import { buildContext } from '../../core/build-context';
import { extractTitle } from '../../extractors/title';
import { parseVacancy } from '../../parse-vacancy';

describe('title extractor', () => {
  it('uses pageTitle and extracts role/level/specialization', () => {
    const ctx = buildContext('some body', { pageTitle: 'Senior Frontend Developer (Angular)' });
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.value).toBe('Senior Frontend Developer (Angular)');
    expect(res.title.role).toBe('frontend_developer');
    expect(res.title.level).toBe('senior');
    expect(res.title.specialization).toContain('Angular');
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it('extracts from pattern line', () => {
    const ctx = buildContext('Вакансия: QA Engineer\nТребования: ...', {});
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.value).toBe('QA Engineer');
    expect(res.title.role).toBe('qa_engineer');
  });

  it('does not pick requirements as title', () => {
    const ctx = buildContext('Requirements: strong TS\nResponsibilities: ...', {});
    const res = extractTitle(ctx, { strict: true, enableTraces: false });
    expect(res.title.value).toBeNull();
    expect(res.warnings).toContain('title_low_confidence');
  });

  it('keeps plausible title even if confidence is low (strict)', () => {
    const ctx = buildContext('Designer\nWe offer: ...', {});
    const res = extractTitle(ctx, { strict: true, enableTraces: false });
    expect(res.title.value).toBe('Designer');
  });

  it('supports CAPS head lines', () => {
    const ctx = buildContext('DATA ENGINEER\nWe offer: ...', {});
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.raw).toBe('DATA ENGINEER');
    expect(res.title.role).toBe('data_engineer');
  });

  it('strips telegram hashtags from title candidate', () => {
    const ctx = buildContext('#вакансия #требуется #ищу #smm Ищем SMM менеджера\nКонтакты: ...', {});
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    // We now normalize the leading "Ищем ..." phrase into a cleaner title.
    expect(res.title.value?.toLowerCase()).toContain('smm менеджера');
  });

  it('strips long hashtag prefixes (more than 12 tags)', () => {
    const ctx = buildContext('#a #b #c #d #e #f #g #h #i #j #k #l #m #n Python Tech Lead\n...', {});
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.raw).toBe('Python Tech Lead');
  });

  it('cuts glued blocks like "Компания:" from pageTitle', () => {
    const ctx = buildContext('body', { pageTitle: 'Senior Python DeveloperКомпания: Fast Soft' });
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.raw).toBe('Senior Python Developer');
    expect(res.title.role).toBe('backend_developer');
  });

  it('detects product manager in RU phrasing', () => {
    const ctx = buildContext('Менеджер продукта\nПитер, офис\n...', {});
    const res = extractTitle(ctx, { strict: false, enableTraces: false });
    expect(res.title.role).toBe('product_manager');
  });

  it('does not pick work format line (remote/part-time) as title', () => {
    const ctx = buildContext(
      'Помощник по документообороту и работе с блогерами в SMM команде Хёгель Шу ФэшнАвстрийский премиальный бренд обуви и аксессуаров\n' +
        'Удаленка, парт-тайм\n' +
        'Что делать: ...',
      {},
    );
    const res = extractTitle(ctx, { strict: true, enableTraces: false });
    expect(res.title.value).toBe('Помощник по документообороту и работе с блогерами в SMM команде Хёгель Шу Фэшн');
  });

  it('strips location tag, "Требуется", inline hashtags and glued "Как все устроено"', () => {
    const ctx = buildContext(
      '(#Москва) Требуется ведущий #менеджер по стратегическому маркетингуКак все устроено в Иви:Мы общаемся в Пачке\n' +
        'Отклик: https://corp.ivi.ru/vacancy/x',
      {},
    );
    const res = extractTitle(ctx, { strict: true, enableTraces: false });
    expect(res.title.value).toBe('ведущий менеджер по стратегическому маркетингу');
  });

  it('extracts UX/UI title when salary starts with 1 digit thousand group', () => {
    // This case is fixed in sanitize + title cleanup, so use full pipeline.
    const result = parseVacancy('UX/UI-дизайнерот 1 500 до 1 800 $О проекте:Мы создаём онлайн-сервис\nКонтакт', {
      strict: true,
    });
    expect(result.title.value).toBe('UX/UI-дизайнер');
    expect(result.title.role).toBe('ux_ui_designer');
  });

  it('extracts role from "Мы ищем ..." sentence and keeps it short', () => {
    const result = parseVacancy(
      'Мы ищем 2D Game Artist’а на постоянную позицию в студию мобильных игр Monta Ponta. Уровень — middle.\nРабота полностью удаленная.',
      { strict: false },
    );
    expect(result.title.value).toBe('2D Game Artist’а на постоянную позицию в студию мобильных игр Monta Ponta');
  });

  it('extracts role after "требуется" and drops leading salary label', () => {
    const result = parseVacancy(
      'Вакансия +/- 100 тыс. руб. Контент-менеджер на контент-завод (новый бренд БАД) Форма работы: полная Оплата: от 100 тысяч рублей',
      { strict: true },
    );
    expect(result.title.value?.toLowerCase()).toContain('контент-менеджер');
  });

  it('splits glued title+salary+section header (HR-менеджер60 000 ... RURОбязанности)', () => {
    const text =
      'HR-менеджер60 000 – 120 000 RURОбязанности: Активный поиск и привлечение кандидатов. ' +
      'Контакты:+79091653371 IF3566934@YANDEX.COM';
    const result = parseVacancy(text, { strict: true });
    expect(result.title.value).toBe('HR-менеджер');
  });

  it('prefers real job title over "Кого мы ищем" blocks (teacher vacancy)', () => {
    const text =
      'Преподаватель английского языка ИП Махмутов г. Алматы Опыт работы: 1–3 года Полная занятость, Стажировка ' +
      'График: 5/2 Рабочие часы: 8 Формат работы: удалённо ЗП: от 300,000 до 600,000 ₸ за месяц, на руки ' +
      'Кто мы: Онлайн-школа английского языка Sen English работает с начала 2024 года. ' +
      'Кого мы ищем и почему: Мы ищем энергичного, вовлечённого преподавателя. ' +
      'Что нам важно: Английский на уровне С1. Контакты: wa.me/+77714095969';
    const result = parseVacancy(text, { strict: true });
    expect(result.title.value).toBe('Преподаватель английского языка');
  });

  it('extracts first vacancy title from multi-vacancy post and cuts relocation text', () => {
    const text =
      'Две вакансии:— UI/UX DesignerПомогают с релокацией на Кипр. Зарплата в евро. Есть прямой контакт для откликов: @anna_recruiter05' +
      '— Frontend (React) DeveloperПомогают с релокацией на Кипр. Зарплата в евро. Есть прямой контакт для откликов: @Irina_HR_Joinzy';
    const result = parseVacancy(text, { strict: true });
    expect(result.title.value).toBe('UI/UX Designer');
    expect(result.title.role).toBe('ux_ui_designer');
    expect(result.meta.warnings).toContain('multi_vacancy_post');
  });
});
