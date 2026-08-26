export type SourceType =
  | 'telegram'
  | 'rss'
  | 'arbeitsagentur'
  | 'arbeitnow'
  | 'remotive'
  | 'themuse'
  | 'remoteok'
  | 'jobicy'
  | 'findwork'
  | 'devitjobs'
  | 'theirstack'
  | 'fantasticjobs'
  | 'jobdata'
  | 'techmap'
  | 'okjob'
  | 'whatjobs'
  | 'usajobs'
  | 'jobs2careers'
  | 'graphqljobs'
  | 'linkedin'
  | 'facebook'
  | 'site'
  | 'email'
  | 'other';

export interface Source {
  id: string;
  name: string;
  sourceType: SourceType;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = 'new' | 'shortlisted' | 'applied' | 'archived';

export interface JobPosting {
  id: string;
  title: string;
  description?: string | null;
  rawContent?: string | null;
  company?: string | null;
  location?: string | null;
  link?: string | null;
  status: JobStatus;
  tags?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  sourceId?: string | null;
  source?: Source | null;
}

export type ApplicationStatus =
  | 'pending'
  | 'sent'
  | 'replied'
  | 'interview'
  | 'offer'
  | 'rejected';

export type ApplicationKind = 'adapted' | 'template';

export interface Application {
  id: string;
  jobPostingId: string;
  channel: string;
  status: ApplicationStatus;
  kind: ApplicationKind;
  resumeVersion?: string | null;
  sentAt: string;
  repliedAt?: string | null;
  interviewAt?: string | null;
  notes?: string | null;
  createdAt: string;
  jobPosting?: JobPosting | null;
}

export type ScoreEventType =
  | 'application_adapted'
  | 'application_template'
  | 'touch'
  | 'call'
  | 'interview'
  | 'post'
  | 'artifact';

export const SCORE_POINTS: Record<ScoreEventType, number> = {
  application_adapted: 2,
  application_template: 1,
  touch: 3,
  call: 8,
  interview: 8,
  post: 5,
  artifact: 4,
};

export interface ScoreEvent {
  id: string;
  date: string;
  type: ScoreEventType;
  points: number;
  note?: string | null;
  applicationId?: string | null;
  createdAt: string;
}

export interface ScoreSummary {
  /** Очки за сегодня */
  today: number;
  /** Порог сегодняшнего дня: 6 будни, 10 суббота, 0 воскресенье */
  todayTarget: number;
  /** Очки текущей недели (пн–вс) */
  week: number;
  /** Минимум недели по плану */
  weekTarget: number;
  /** Два дня подряд (не считая воскресений) без очков */
  redFlag: boolean;
  /** Очки по дням текущей недели, ключ YYYY-MM-DD */
  byDay: Record<string, number>;
}

export interface Resume {
  id: string;
  /** Короткое имя версии, попадает в Application.resumeVersion (например, «DM v1») */
  name: string;
  /** Заголовок резюме (роль в шапке) */
  title: string;
  /** Полный текст резюме для рассылки */
  content: string;
  notes?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A/B-статистика откликов по версии резюме */
export interface ResumeStats {
  resumeVersion: string;
  sent: number;
  replied: number;
  interviews: number;
}

export interface FunnelStats {
  applicationsTotal: number;
  applicationsAdapted: number;
  applicationsTemplate: number;
  replied: number;
  interviews: number;
  offers: number;
  rejected: number;
  touches: number;
  calls: number;
  posts: number;
  artifacts: number;
}

export interface Template {
  id: string;
  name: string;
  content: string;
  channel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  id: number;
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface ProxyRecord {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks5';
  username?: string | null;
  password?: string | null;
  userAgent?: string | null;
  userAgentSource?: string | null;
  userAgentUpdatedAt?: string | null;
  cookieHeader?: string | null;
  cookieSource?: string | null;
  cookieUpdatedAt?: string | null;
  active: boolean;
  lastCheckedAt?: string | null;
  lastStatus?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
