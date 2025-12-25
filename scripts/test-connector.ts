import { TelegramHttpConnector } from '@job-farm/scrapers';

async function main() {
  const connector = new TelegramHttpConnector();
  const jobs = await connector.fetchNewJobs({
    sourceId: 'test',
    sourceType: 'telegram',
    url: 'https://t.me/devjobs',
    metadata: {},
  });
  console.log('jobs len', jobs.length);
  console.log(jobs.slice(0, 3));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
