import { TelegramHttpConnector } from '@job-farm/scrapers';
import { Prisma } from '@prisma/client';

async function main() {
  const connector = new TelegramHttpConnector();
  const items = await connector.fetchNewJobs({
    sourceId: 'src-devjobs',
    sourceType: 'telegram',
    url: 'https://t.me/devjobs',
    metadata: {},
  });

  const seenHashes = new Set<string>();
  const payloads = items.reduce<Prisma.JobPostingCreateManyInput[]>((acc, i) => {
    const link =
      i.link && /^https?:\/\//.test(i.link)
        ? i.link
        : i.messageId
        ? `https://t.me/${i.channel ?? ''}/${i.messageId}`
        : null;
    if (!link) {
      return acc;
    }
    const jobHash = i.hash ?? null;
    if (jobHash && seenHashes.has(jobHash)) {
      return acc;
    }
    if (jobHash) {
      seenHashes.add(jobHash);
    }
    acc.push({
      title: i.title,
      description: (i.description ?? '').slice(0, 4000),
      company: i.company ?? null,
      location: i.location ?? null,
      link,
      sourceId: 'src-devjobs',
      status: 'new',
      tags: i.tags ?? null,
      publishedAt: i.publishedAt ?? new Date(),
    });
    return acc;
  }, []);

  console.log('prepared length', payloads.length);
  console.log(payloads.slice(0, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
