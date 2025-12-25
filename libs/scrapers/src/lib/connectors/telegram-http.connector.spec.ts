import axios from 'axios';
import { TelegramHttpConnector } from './telegram-http.connector';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramHttpConnector', () => {
  const connector = new TelegramHttpConnector();

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-12-18T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns only new messages after lastSeen and within 14 days', async () => {
    const html = `
      <div class="tgme_widget_message" data-post="channel/6">
        <time datetime="2025-12-17T10:00:00+00:00"></time>
        <div class="tgme_widget_message_text">
          Senior Dev
          <a href="https://example.com/job">link</a>
        </div>
      </div>
      <div class="tgme_widget_message" data-post="channel/4">
        <time datetime="2025-12-01T10:00:00+00:00"></time>
        <div class="tgme_widget_message_text">Old post</div>
      </div>
    `;
    mockedAxios.get.mockResolvedValueOnce({ data: html });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'telegram',
      url: 'https://t.me/s/channel',
      metadata: { lastMessageId: 5, maxPages: 1 },
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      messageId: 6,
      channel: 'channel',
      link: 'https://example.com/job',
      title: 'Senior Dev',
    });
    expect(jobs[0].hash).toBeDefined();
  });

  it('stops when all messages are older than cutoff', async () => {
    const oldHtml = `
      <div class="tgme_widget_message" data-post="channel/10">
        <time datetime="2025-11-15T10:00:00+00:00"></time>
        <div class="tgme_widget_message_text">Too old</div>
      </div>
    `;
    mockedAxios.get.mockResolvedValueOnce({ data: oldHtml });

    const jobs = await connector.fetchNewJobs({
      sourceId: 's1',
      sourceType: 'telegram',
      url: 'https://t.me/s/channel',
      metadata: { lastMessageId: 0, maxPages: 1 },
    });

    expect(jobs).toHaveLength(0);
  });

  it('throws ProxyBlockedError on 403', async () => {
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 403 } });
    await expect(
      connector.fetchNewJobs({
        sourceId: 's1',
        sourceType: 'telegram',
        url: 'https://t.me/s/channel',
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});
