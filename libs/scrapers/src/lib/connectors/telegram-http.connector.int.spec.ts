import axios from 'axios';
import { TelegramHttpConnector } from './telegram-http.connector';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const daysAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
};

describe('TelegramHttpConnector integration-like pagination', () => {
  const connector = new TelegramHttpConnector();

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('stops pagination when hits old messageId', async () => {
    const page1 = `
      <div class="tgme_widget_message" data-post="channel/12">
        <time datetime="${daysAgo(1)}"></time>
        <div class="tgme_widget_message_text">Fresh</div>
      </div>
    `;
    const page2 = `
      <div class="tgme_widget_message" data-post="channel/5">
        <time datetime="${daysAgo(6)}"></time>
        <div class="tgme_widget_message_text">Old</div>
      </div>
    `;
    mockedAxios.get.mockResolvedValueOnce({ data: page1 });
    mockedAxios.get.mockResolvedValueOnce({ data: page2 });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'telegram',
      url: 'https://t.me/s/channel',
      metadata: { lastMessageId: 10, maxPages: 2, delayMs: 0, jitterMs: 0 },
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].messageId).toBe(12);
    // вторая страница запрошена через ?before=<minId первой страницы>
    expect(mockedAxios.get.mock.calls[1][0]).toBe('https://t.me/s/channel?before=12');
  });

  it('собирает свежие посты, даже если наверху страницы старые (редкий канал)', async () => {
    // t.me/s рендерит от старых к новым: старый пост сверху, свежая вакансия снизу
    const page = `
      <div class="tgme_widget_message" data-post="channel/100">
        <time datetime="${daysAgo(40)}"></time>
        <div class="tgme_widget_message_text">Очень старый пост про мероприятие</div>
      </div>
      <div class="tgme_widget_message" data-post="channel/101">
        <time datetime="${daysAgo(2)}"></time>
        <div class="tgme_widget_message_text">Вакансия: Project Manager, удалёнка, вилка 150-200к</div>
      </div>
    `;
    mockedAxios.get.mockResolvedValueOnce({ data: page });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'telegram',
      url: 'https://t.me/s/channel',
      metadata: { lastMessageId: 0, maxPages: 1, delayMs: 0, jitterMs: 0 },
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].messageId).toBe(101);
  });
});
