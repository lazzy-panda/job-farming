import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyDbRow } from '../proxies/proxy.types';

@Injectable()
export class ProxyManagerService {
  constructor(private readonly prisma: PrismaService) {}

  async getNext(): Promise<ProxyDbRow | null> {
    const proxyDelegate = this.prisma.proxy as unknown as {
      findFirst(args?: unknown): Promise<ProxyDbRow | null>;
      update(args: unknown): Promise<ProxyDbRow>;
    };

    const proxy = await proxyDelegate.findFirst({
      where: { active: true },
      orderBy: [
        { lastUsedAt: 'asc' },
        { updatedAt: 'asc' },
      ],
    });
    if (!proxy) return null;
    await proxyDelegate.update({
      where: { id: proxy.id },
      data: { updatedAt: new Date(), lastCheckedAt: new Date(), lastUsedAt: new Date() },
    });
    return proxy;
  }

  async markBad(proxyId: string, reason?: string) {
    const proxyDelegate = this.prisma.proxy as unknown as { update(args: unknown): Promise<ProxyDbRow> };
    await proxyDelegate.update({
      where: { id: proxyId },
      data: {
        active: false,
        lastStatus: reason ?? 'bad',
        lastCheckedAt: new Date(),
        lastUsedAt: null,
      },
    });
  }

  async markBlocked(proxyId: string, status: number) {
    await this.markBad(proxyId, `blocked:${status}`);
  }
}
