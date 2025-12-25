import { buildContext } from '../../core/build-context';
import { extractTech } from '../../extractors/tech';

describe('tech extractor', () => {
  it('splits must vs plus by sections', () => {
    const ctx = buildContext(
      'Requirements:\n- TypeScript\n- Node.js\nNice to have:\n- Kafka\nOther:\n- Docker',
      {},
    );
    const res = extractTech(ctx, { enableTraces: false });
    expect(res.tech.must).toEqual(expect.arrayContaining(['TypeScript', 'Node.js']));
    expect(res.tech.plus).toEqual(expect.arrayContaining(['Kafka']));
  });

  it('does not treat latin C in Cyrillic word as C language', () => {
    // Some Telegram posts contain a latin 'C' in Cyrillic word "Cоздание" (copy/paste artifact).
    const ctx = buildContext('Что предстоит делать: Cоздание рекламных видео креативов', {});
    const res = extractTech(ctx, { enableTraces: false });
    expect(res.tech.all).not.toContain('C');
  });
});
