import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Template } from '@job-farm/shared-models';

interface CreateTemplateDto {
  name: string;
  content: string;
  channel?: string;
}

type UpdateTemplateDto = Partial<CreateTemplateDto>;

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Template[]> {
    return this.prisma.template.findMany().then((items) => items.map((t) => this.mapTemplate(t)));
  }

  create(dto: CreateTemplateDto): Promise<Template> {
    return this.prisma.template.create({ data: dto }).then((t) => this.mapTemplate(t));
  }

  async update(id: string, dto: UpdateTemplateDto): Promise<Template> {
    try {
      const updated = await this.prisma.template.update({
        where: { id },
        data: dto,
      });
      return this.mapTemplate(updated);
    } catch {
      throw new NotFoundException('Template not found');
    }
  }

  async remove(id: string): Promise<Template> {
    try {
      const deleted = await this.prisma.template.delete({ where: { id } });
      return this.mapTemplate(deleted);
    } catch {
      throw new NotFoundException('Template not found');
    }
  }

  private mapTemplate(t: {
    id: string;
    name: string;
    content: string;
    channel: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Template {
    return {
      id: t.id,
      name: t.name,
      content: t.content,
      channel: t.channel ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}
