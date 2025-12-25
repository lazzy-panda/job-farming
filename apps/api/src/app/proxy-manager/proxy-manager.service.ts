import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProxyManagerService {
  constructor(private readonly prisma: PrismaService) {}

  async getNext() {
    const proxy = await this.prisma.proxy.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'asc' },
    });
    if (!proxy) return null;
    await this.prisma.proxy.update({
      where: { id: proxy.id },
      data: { updatedAt: new Date(), lastCheckedAt: new Date() },
    });
    return proxy;
  }

  async markBad(proxyId: string, reason?: string) {
    await this.prisma.proxy.update({
      where: { id: proxyId },
      data: {
        active: false,
        lastStatus: reason ?? 'bad',
        lastCheckedAt: new Date(),
      },
    });
  }

  async markBlocked(proxyId: string, status: number) {
    await this.markBad(proxyId, `blocked:${status}`);
  }
}

