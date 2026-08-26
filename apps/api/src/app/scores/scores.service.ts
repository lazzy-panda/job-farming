import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SCORE_POINTS,
  ScoreEvent,
  ScoreEventType,
  ScoreSummary,
} from '@job-farm/shared-models';

/** Типы, которые вносятся вручную (отклики и собеседования начисляются автоматически) */
const MANUAL_TYPES: ScoreEventType[] = ['touch', 'call', 'interview', 'post', 'artifact'];

/** Неделя 1 плана (31.08–06.09) — минимум 35 очков, дальше 45 */
const PLAN_WEEK1_END = new Date(2026, 8, 7);

@Injectable()
export class ScoresService {
  constructor(private readonly prisma: PrismaService) {}

  list(from?: string, to?: string): Promise<ScoreEvent[]> {
    const where: { date?: { gte?: Date; lte?: Date } } = {};
    if (from || to) {
      where.date = {};
      if (from) {
        where.date.gte = new Date(from);
      }
      if (to) {
        where.date.lte = new Date(to);
      }
    }
    return this.prisma.scoreEvent
      .findMany({ where, orderBy: { date: 'desc' } })
      .then((events) => events.map((e) => this.mapEvent(e)));
  }

  async create(dto: { type: string; note?: string; date?: string }): Promise<ScoreEvent> {
    const type = dto.type as ScoreEventType;
    if (!MANUAL_TYPES.includes(type)) {
      throw new BadRequestException(
        `Недопустимый тип события. Вручную вносятся: ${MANUAL_TYPES.join(', ')}`,
      );
    }
    const created = await this.prisma.scoreEvent.create({
      data: {
        type,
        points: SCORE_POINTS[type],
        note: dto.note?.trim() || null,
        date: dto.date ? new Date(dto.date) : new Date(),
      },
    });
    return this.mapEvent(created);
  }

  async remove(id: string): Promise<ScoreEvent> {
    try {
      const deleted = await this.prisma.scoreEvent.delete({ where: { id } });
      return this.mapEvent(deleted);
    } catch {
      throw new NotFoundException('Score event not found');
    }
  }

  async summary(): Promise<ScoreSummary> {
    const now = new Date();
    const todayKey = this.dayKey(now);
    const weekStart = this.startOfWeek(now);

    // Берём запас в 2 недели: для red-flag нужны дни прошлой недели
    const since = new Date(weekStart);
    since.setDate(since.getDate() - 7);

    const events = await this.prisma.scoreEvent.findMany({
      where: { date: { gte: since } },
      select: { date: true, points: true },
    });
    const totalEvents = await this.prisma.scoreEvent.count();

    const pointsByDay = new Map<string, number>();
    for (const event of events) {
      const key = this.dayKey(event.date);
      pointsByDay.set(key, (pointsByDay.get(key) ?? 0) + event.points);
    }

    const byDay: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + i);
      if (day > now) {
        break;
      }
      const key = this.dayKey(day);
      byDay[key] = pointsByDay.get(key) ?? 0;
    }

    // «Два дня подряд по нулям — красный флаг»: два предыдущих дня без очков
    // (воскресенье — выходной, не считается). Не флагаем пустую базу.
    let redFlag = false;
    if (totalEvents > 0) {
      const checked: number[] = [];
      const cursor = new Date(now);
      while (checked.length < 2) {
        cursor.setDate(cursor.getDate() - 1);
        if (cursor.getDay() === 0) {
          continue;
        }
        checked.push(pointsByDay.get(this.dayKey(cursor)) ?? 0);
      }
      redFlag = checked.every((points) => points === 0);
    }

    const week = Object.values(byDay).reduce((sum, points) => sum + points, 0);

    return {
      today: pointsByDay.get(todayKey) ?? 0,
      todayTarget: this.dayTarget(now),
      week,
      weekTarget: now < PLAN_WEEK1_END ? 35 : 45,
      redFlag,
      byDay,
    };
  }

  /** Порог дня: будни 6, суббота 10, воскресенье 0 (выходной) */
  private dayTarget(date: Date): number {
    const day = date.getDay();
    if (day === 0) {
      return 0;
    }
    return day === 6 ? 10 : 6;
  }

  private startOfWeek(date: Date): Date {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = start.getDay();
    const shift = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - shift);
    return start;
  }

  private dayKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private mapEvent(e: {
    id: string;
    date: Date;
    type: string;
    points: number;
    note: string | null;
    applicationId: string | null;
    createdAt: Date;
  }): ScoreEvent {
    return {
      id: e.id,
      date: e.date.toISOString(),
      type: e.type as ScoreEventType,
      points: e.points,
      note: e.note,
      applicationId: e.applicationId,
      createdAt: e.createdAt.toISOString(),
    };
  }
}
