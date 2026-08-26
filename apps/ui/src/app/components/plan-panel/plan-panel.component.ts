import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Application, FunnelStats, ScoreEvent, ScoreSummary } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';

interface CheckpointNorm {
  label: string;
  date: string;
  applications: number;
  replies?: number;
  interviews?: number;
}

/** Нормы чекпоинтов 12-недельного плана */
const CHECKPOINTS: CheckpointNorm[] = [
  { label: 'Чекпоинт №1 · сб 26.09', date: '2026-09-26', applications: 55, replies: 4, interviews: 2 },
  { label: 'Чекпоинт №2 · сб 24.10', date: '2026-10-24', applications: 100, interviews: 8 },
  { label: 'Чекпоинт №3 · сб 21.11', date: '2026-11-21', applications: 150 },
];

interface ManualScoreButton {
  type: ScoreEvent['type'];
  label: string;
  points: number;
  icon: string;
}

@Component({
  standalone: true,
  selector: 'app-plan-panel',
  imports: [CommonModule],
  templateUrl: './plan-panel.component.html',
  styleUrls: ['./plan-panel.component.scss'],
})
export class PlanPanelComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly summary = signal<ScoreSummary | null>(null);
  readonly stats = signal<FunnelStats | null>(null);
  readonly followups = signal<Application[]>([]);
  readonly showFollowups = signal(false);
  readonly busy = signal(false);

  readonly manualButtons: ManualScoreButton[] = [
    { type: 'touch', label: 'Касание', points: 3, icon: 'chat' },
    { type: 'call', label: 'Созвон', points: 8, icon: 'call' },
    { type: 'post', label: 'Пост', points: 5, icon: 'campaign' },
    { type: 'artifact', label: 'Артефакт', points: 4, icon: 'description' },
  ];

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.api.getScoreSummary().subscribe((s) => this.summary.set(s));
    this.api.getFunnelStats().subscribe((s) => this.stats.set(s));
    this.api.getFollowups().subscribe((f) => this.followups.set(f));
  }

  addManual(type: ScoreEvent['type']): void {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.createScoreEvent({ type }).subscribe({
      next: () => this.refresh(),
      complete: () => this.busy.set(false),
      error: () => this.busy.set(false),
    });
  }

  markReplied(app: Application): void {
    this.api.updateApplication(app.id, { status: 'replied' }).subscribe(() => this.refresh());
  }

  markInterview(app: Application): void {
    this.api.updateApplication(app.id, { status: 'interview' }).subscribe(() => this.refresh());
  }

  toggleFollowups(): void {
    this.showFollowups.update((v) => !v);
  }

  get checkpoint(): CheckpointNorm {
    const today = new Date().toISOString().slice(0, 10);
    return CHECKPOINTS.find((c) => c.date >= today) ?? CHECKPOINTS[CHECKPOINTS.length - 1];
  }

  daysWaiting(app: Application): number {
    if (!app.sentAt) {
      return 0;
    }
    const sent = new Date(app.sentAt).getTime();
    return Math.max(0, Math.floor((Date.now() - sent) / (24 * 60 * 60 * 1000)));
  }

  jobLabel(app: Application): string {
    const title = app.jobPosting?.title ?? 'Вакансия';
    const company = app.jobPosting?.company;
    return company ? `${title} — ${company}` : title;
  }
}
