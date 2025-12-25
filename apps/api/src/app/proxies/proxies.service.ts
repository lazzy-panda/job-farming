import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyRecord } from '@job-farm/shared-models';

interface CreateProxyDto {
  host: string;
  port: number;
  username?: string;
  password?: string;
  active?: boolean;
}

interface UpdateProxyDto extends Partial<CreateProxyDto> {
  lastCheckedAt?: Date;
  lastStatus?: string;
}

@Injectable()
export class ProxiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<ProxyRecord[]> {
    return this.prisma.proxy.findMany().then((items) => items.map((p) => this.mapProxy(p)));
  }

  create(dto: CreateProxyDto): Promise<ProxyRecord> {
    return this.prisma.proxy
      .create({
        data: {
          host: dto.host,
          port: dto.port,
          username: dto.username,
          password: dto.password,
          active: dto.active ?? true,
        },
      })
      .then((p) => this.mapProxy(p));
  }

  async update(id: string, dto: UpdateProxyDto): Promise<ProxyRecord> {
    try {
      const updated = await this.prisma.proxy.update({
        where: { id },
        data: dto,
      });
      return this.mapProxy(updated);
    } catch {
      throw new NotFoundException('Proxy not found');
    }
  }

  async remove(id: string): Promise<ProxyRecord> {
    try {
      const deleted = await this.prisma.proxy.delete({ where: { id } });
      return this.mapProxy(deleted);
    } catch {
      throw new NotFoundException('Proxy not found');
    }
  }

  private mapProxy(p: {
    id: string;
    host: string;
    port: number;
    username: string | null;
    password: string | null;
    active: boolean;
    lastCheckedAt: Date | null;
    lastStatus: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProxyRecord {
    return {
      id: p.id,
      host: p.host,
      port: p.port,
      username: p.username ?? null,
      password: p.password ?? null,
      active: p.active,
      lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : null,
      lastStatus: p.lastStatus ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}

