import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyRecord } from '@job-farm/shared-models';
import { ProxyDbRow } from './proxy.types';

interface CreateProxyDto {
  host: string;
  port: number;
  protocol?: 'http' | 'https' | 'socks5';
  username?: string;
  password?: string;
  userAgent?: string;
  userAgentSource?: string;
  cookieHeader?: string;
  cookieSource?: string;
  active?: boolean;
}

interface UpdateProxyDto extends Partial<CreateProxyDto> {
  lastCheckedAt?: Date;
  lastStatus?: string;
  userAgentUpdatedAt?: Date | null;
  cookieUpdatedAt?: Date | null;
}

@Injectable()
export class ProxiesService {
  constructor(private readonly prisma: PrismaService) {}

  private mapProxy(p: ProxyDbRow): ProxyRecord {
    return {
      id: p.id,
      host: p.host,
      port: p.port,
      protocol: p.protocol,
      username: p.username ?? null,
      password: p.password ?? null,
      userAgent: p.userAgent ?? null,
      userAgentSource: p.userAgentSource ?? null,
      userAgentUpdatedAt: p.userAgentUpdatedAt
        ? p.userAgentUpdatedAt.toISOString()
        : null,
      cookieHeader: p.cookieHeader ?? null,
      cookieSource: p.cookieSource ?? null,
      cookieUpdatedAt: p.cookieUpdatedAt ? p.cookieUpdatedAt.toISOString() : null,
      active: p.active,
      lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : null,
      lastStatus: p.lastStatus ?? null,
      lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  findAll(): Promise<ProxyRecord[]> {
    return this.prisma.proxy
      .findMany()
      .then((items) => items.map((p) => this.mapProxy(p as ProxyDbRow)));
  }

  create(dto: CreateProxyDto): Promise<ProxyRecord> {
    return this.prisma.proxy
      .create({
        data: {
          host: dto.host,
          port: dto.port,
          protocol: dto.protocol ?? 'http',
          username: dto.username,
          password: dto.password,
          active: dto.active ?? true,
          userAgent: dto.userAgent ?? null,
          userAgentSource: dto.userAgent ? 'manual' : null,
          userAgentUpdatedAt: dto.userAgent ? new Date() : null,
          cookieHeader: dto.cookieHeader ?? null,
          cookieSource: dto.cookieHeader ? 'manual' : null,
          cookieUpdatedAt: dto.cookieHeader ? new Date() : null,
        } as unknown as Prisma.ProxyCreateInput,
      })
      .then((p) => this.mapProxy(p as ProxyDbRow));
  }

  async update(id: string, dto: UpdateProxyDto): Promise<ProxyRecord> {
    try {
      const updated = await this.prisma.proxy.update({
        where: { id },
        data: {
          ...dto,
          protocol: dto.protocol ?? 'http',
          userAgent: dto.userAgent ?? null,
          userAgentSource: dto.userAgent
            ? dto.userAgentSource ?? 'manual'
            : dto.userAgentSource ?? undefined,
          userAgentUpdatedAt:
            dto.userAgent !== undefined
              ? dto.userAgent
                ? new Date()
                : null
              : undefined,
          cookieHeader: dto.cookieHeader ?? null,
          cookieSource: dto.cookieHeader
            ? dto.cookieSource ?? 'manual'
            : dto.cookieSource ?? undefined,
          cookieUpdatedAt:
            dto.cookieHeader !== undefined
              ? dto.cookieHeader
                ? new Date()
                : null
              : undefined,
        } as unknown as Prisma.ProxyUpdateInput,
      });
      return this.mapProxy(updated as ProxyDbRow);
    } catch {
      throw new NotFoundException('Proxy not found');
    }
  }

  async remove(id: string): Promise<ProxyRecord> {
    try {
      const deleted = await this.prisma.proxy.delete({ where: { id } });
      return this.mapProxy(deleted as ProxyDbRow);
    } catch {
      throw new NotFoundException('Proxy not found');
    }
  }
}
