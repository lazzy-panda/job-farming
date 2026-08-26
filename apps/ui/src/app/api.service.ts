import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  Application,
  FunnelStats,
  JobPosting,
  ProxyRecord,
  Resume,
  ResumeStats,
  ScoreEvent,
  ScoreSummary,
  Source,
  Template,
} from '@job-farm/shared-models';

const API_BASE = 'http://127.0.0.1:3000/api';

export interface VacancyParseRequest {
  text: string;
  pageTitle?: string;
  sourceUrl?: string;
  debug?: boolean;
}

// UI should not depend on vacancy-parser library code (Node-only require() exists there).
// Keep a minimal DTO type for displaying/logging parse results from API.
export interface VacancyParseResult {
  title?: unknown;
  salary?: unknown;
  contacts?: unknown;
  employment?: unknown;
  workFormat?: unknown;
  schedule?: unknown;
  location?: unknown;
  experience?: unknown;
  tech?: unknown;
  languages?: unknown;
  benefits?: unknown;
  interview?: unknown;
  company?: unknown;
  confidence?: unknown;
  meta?: { warnings?: string[]; lang?: string; timingMs?: number; sourceUrl?: string | null; traces?: unknown[] };
}

export interface TranslationResponse {
  text: string;
  targetLang: string;
  sourceLang?: string | null;
  provider?: string;
  model?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  getJobPostings(params?: {
    skip?: number;
    take?: number;
    sourceId?: string;
    status?: string;
  }) {
    let httpParams = new HttpParams();
    if (params?.skip !== undefined) httpParams = httpParams.set('skip', params.skip);
    if (params?.take !== undefined) httpParams = httpParams.set('take', params.take);
    if (params?.sourceId) httpParams = httpParams.set('sourceId', params.sourceId);
    if (params?.status) httpParams = httpParams.set('status', params.status);
    return this.http.get<JobPosting[]>(`${API_BASE}/job-postings`, {
      params: httpParams,
    });
  }

  createJobPosting(payload: Partial<JobPosting>) {
    return this.http.post<JobPosting>(`${API_BASE}/job-postings`, payload);
  }

  runScrape() {
    return this.http.post<{ status: string }>(`${API_BASE}/job-postings/scrape`, {});
  }

  deleteJobPosting(id: string) {
    return this.http.delete<JobPosting>(`${API_BASE}/job-postings/${id}`);
  }

  getSources() {
    return this.http.get<Source[]>(`${API_BASE}/sources`);
  }

  getTemplates() {
    return this.http.get<Template[]>(`${API_BASE}/templates`);
  }

  createApplication(payload: Partial<Application>) {
    return this.http.post<Application>(`${API_BASE}/applications`, payload);
  }

  getApplications() {
    return this.http.get<Application[]>(`${API_BASE}/applications`);
  }

  updateApplication(id: string, payload: Partial<Application>) {
    return this.http.patch<Application>(`${API_BASE}/applications/${id}`, payload);
  }

  getFunnelStats() {
    return this.http.get<FunnelStats>(`${API_BASE}/applications/stats`);
  }

  getFollowups() {
    return this.http.get<Application[]>(`${API_BASE}/applications/followups`);
  }

  updateJobPostingStatus(id: string, status: JobPosting['status']) {
    return this.http.patch<JobPosting>(`${API_BASE}/job-postings/${id}`, { status });
  }

  getScoreSummary() {
    return this.http.get<ScoreSummary>(`${API_BASE}/scores/summary`);
  }

  createScoreEvent(payload: { type: ScoreEvent['type']; note?: string; date?: string }) {
    return this.http.post<ScoreEvent>(`${API_BASE}/scores`, payload);
  }

  deleteScoreEvent(id: string) {
    return this.http.delete<ScoreEvent>(`${API_BASE}/scores/${id}`);
  }

  createSource(payload: Partial<Source>) {
    console.log('[ApiService] createSource request:', payload);
    return this.http.post<Source>(`${API_BASE}/sources`, payload);
  }

  deleteSource(id: string) {
    return this.http.delete<Source>(`${API_BASE}/sources/${id}`);
  }

  createTemplate(payload: Partial<Template>) {
    return this.http.post<Template>(`${API_BASE}/templates`, payload);
  }

  updateTemplate(id: string, payload: Partial<Template>) {
    return this.http.patch<Template>(`${API_BASE}/templates/${id}`, payload);
  }

  deleteTemplate(id: string) {
    return this.http.delete<Template>(`${API_BASE}/templates/${id}`);
  }

  getResumes() {
    return this.http.get<Resume[]>(`${API_BASE}/resumes`);
  }

  getResumeStats() {
    return this.http.get<ResumeStats[]>(`${API_BASE}/resumes/stats`);
  }

  createResume(payload: Partial<Resume>) {
    return this.http.post<Resume>(`${API_BASE}/resumes`, payload);
  }

  updateResume(id: string, payload: Partial<Resume>) {
    return this.http.patch<Resume>(`${API_BASE}/resumes/${id}`, payload);
  }

  deleteResume(id: string) {
    return this.http.delete<Resume>(`${API_BASE}/resumes/${id}`);
  }

  getSettings() {
    return this.http.get<Record<string, string | number> | null>(`${API_BASE}/settings`);
  }

  saveSettings(data: Record<string, unknown>) {
    return this.http.post(`${API_BASE}/settings`, data);
  }

  parseVacancy(payload: VacancyParseRequest) {
    return this.http.post<VacancyParseResult>(`${API_BASE}/vacancies/parse`, payload);
  }

  getProxies() {
    return this.http.get<ProxyRecord[]>(`${API_BASE}/proxies`);
  }

  createProxy(payload: {
    host: string;
    port: number;
    protocol?: 'http' | 'https' | 'socks5';
    username?: string;
    password?: string;
    userAgent?: string;
    cookieHeader?: string;
    active?: boolean;
  }) {
    return this.http.post<ProxyRecord>(`${API_BASE}/proxies`, payload);
  }

  updateProxy(id: string, payload: Partial<ProxyRecord>) {
    return this.http.patch<ProxyRecord>(`${API_BASE}/proxies/${id}`, payload);
  }

  deleteProxy(id: string) {
    return this.http.delete<ProxyRecord>(`${API_BASE}/proxies/${id}`);
  }

  translateText(payload: { text: string; targetLang?: string; sourceLang?: string; jobId?: string }) {
    return this.http.post<TranslationResponse>(`${API_BASE}/translations`, payload);
  }
}
