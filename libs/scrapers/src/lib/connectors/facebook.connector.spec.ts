import axios from 'axios';
import { FacebookConnector } from './facebook.connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const GROUP_URL = 'https://www.facebook.com/groups/itjobs.example';

const ctx = (cookieHeader: string | null) => ({
  sourceId: 's1',
  sourceType: 'facebook',
  url: GROUP_URL,
  metadata: cookieHeader ? { cookieHeader } : {},
});

const postJson = (id: string, text: string, ts: number) =>
  `{"post_id":"${id}","creation_time":${ts},"message":{"text":"${text}"}}`;

describe('FacebookConnector', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('без cookies кидает facebook_cookies_required', async () => {
    const connector = new FacebookConnector();
    await expect(connector.fetchNewJobs(ctx(null))).rejects.toThrow('facebook_cookies_required');
  });

  it('распознаёт login-стену', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: '<html><form id="login_form"></form></html>',
      request: { res: { responseUrl: 'https://www.facebook.com/login/?next=...' } },
    });
    const connector = new FacebookConnector();
    await expect(connector.fetchNewJobs(ctx('c_user=1; xs=abc'))).rejects.toThrow(
      'facebook_login_required',
    );
  });

  it('извлекает посты: заголовок, текст, ссылку на пост, дату и хэш', async () => {
    const text1 =
      'Вакансия: Delivery Manager\\nКомпания: Пример\\nЗП: 200 000 ₽\\nУдалённо, полная занятость';
    const text2 =
      'Ищем руководителя проектов в аутсорс-студию.\\nОпыт от 3 лет, удалёнка, вилка 150-220к.';
    const html = `<html><script>${postJson('111222333444', text1, 1756200000)}</script><script>${postJson('555666777888', text2, 1756100000)}</script></html>`;
    mockedAxios.get.mockResolvedValueOnce({ data: html, request: { res: { responseUrl: GROUP_URL } } });

    const connector = new FacebookConnector();
    const jobs = await connector.fetchNewJobs(ctx('c_user=1; xs=abc'));

    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Вакансия: Delivery Manager');
    expect(jobs[0].description).toContain('Компания: Пример');
    expect(jobs[0].link).toBe('https://www.facebook.com/groups/itjobs.example/posts/111222333444/');
    expect(jobs[0].publishedAt?.getTime()).toBe(1756200000 * 1000);
    expect(jobs[0].hash).toHaveLength(40);
    expect(jobs[1].link).toBe('https://www.facebook.com/groups/itjobs.example/posts/555666777888/');
  });

  it('дедуплицирует одинаковые тексты и режет короткие', async () => {
    const text = 'Вакансия: Project Manager, удалённо, вилка 150-200к, компания Пример';
    const html = `<html>${postJson('1000000001', text, 1756200000)}${postJson('1000000002', text, 1756200000)}${postJson('1000000003', 'коротко', 1756200000)}</html>`;
    mockedAxios.get.mockResolvedValueOnce({ data: html, request: { res: { responseUrl: GROUP_URL } } });

    const connector = new FacebookConnector();
    const jobs = await connector.fetchNewJobs(ctx('c_user=1; xs=abc'));
    expect(jobs).toHaveLength(1);
  });
});
