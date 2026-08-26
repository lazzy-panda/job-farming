import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import * as path from 'path';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

type TranslatePayload = {
  text?: string;
  targetLang?: string;
  sourceLang?: string;
  jobId?: string;
};

type ArgosQueueEntry = {
  resolve: (value: string) => void;
  reject: (reason?: Error) => void;
  timeout: NodeJS.Timeout;
};

@Injectable()
export class TranslationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranslationsService.name);
  private readonly enabled = this.parseBoolean(process.env.TRANSLATION_ENABLED, true);
  private readonly provider =
    (process.env.TRANSLATION_PROVIDER ?? 'local').trim().toLowerCase() || 'local';
  private readonly providerBaseUrl =
    process.env.TRANSLATION_BASE_URL?.replace(/\/$/, '') || 'http://127.0.0.1:11434';
  private readonly providerModel = process.env.TRANSLATION_MODEL || 'llama3.1:8b-instruct-q4_K_M';
  private readonly timeoutMs = Number(process.env.TRANSLATION_TIMEOUT_MS ?? 60000);
  private readonly maxChars = Number(process.env.TRANSLATION_MAX_CHARS ?? 12000);
  private readonly argosPython =
    process.env.ARGOS_PYTHON_BIN || path.join(process.cwd(), 'storage', 'argos-env', 'bin', 'python3');
  private readonly argosWorkerScript =
    process.env.ARGOS_WORKER_SCRIPT || path.join(process.cwd(), 'scripts', 'argos_worker.py');
  private readonly argosTimeoutMs = Number(process.env.TRANSLATION_LOCAL_TIMEOUT_MS ?? 45000);
  private readonly preloadLocal = this.parseBoolean(process.env.TRANSLATION_PRELOAD, true);

  private argosWorker: ChildProcessWithoutNullStreams | null = null;
  private argosBuffer = '';
  private argosQueue: ArgosQueueEntry[] = [];

  onModuleInit(): void {
    if (this.enabled && this.provider === 'local' && this.preloadLocal) {
      void this.ensureArgosWorker();
    }
  }

  onModuleDestroy(): void {
    this.teardownArgosWorker();
  }

  async translate(payload: TranslatePayload) {
    if (!this.enabled) {
      throw new ServiceUnavailableException('translation_disabled');
    }
    const text = (payload.text ?? '').trim();
    if (!text) {
      throw new BadRequestException('text_required');
    }
    if (text.length > this.maxChars) {
      throw new BadRequestException(`text_too_long_${text.length}`);
    }

    const targetLang = (payload.targetLang ?? 'ru').trim().toLowerCase();
    const sourceLang = payload.sourceLang?.trim()?.toLowerCase() ?? null;

    if (this.provider === 'local') {
      return this.translateLocally(text, targetLang, sourceLang);
    }

    const prompt = this.buildPrompt(text, targetLang, sourceLang);
    const url = `${this.providerBaseUrl}/api/generate`;
    try {
      const response = await axios.post(
        url,
        {
          model: this.providerModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_ctx: 4096,
            stop: ['<END_TRANSLATION>'],
          },
        },
        { timeout: this.timeoutMs },
      );
      const result = (response.data?.response as string | undefined)?.trim();
      if (!result) {
        throw new Error('empty_response');
      }
      return {
        text: this.stripStopTokens(result),
        targetLang,
        sourceLang,
        provider: 'ollama',
        model: this.providerModel,
      };
    } catch (error) {
      const err = error as { response?: { data?: unknown; status?: number }; message?: string };
      this.logger.error(
        `translate failed model=${this.providerModel} status=${err.response?.status ?? 'n/a'}: ${
          err.message ?? error
        }`,
      );
      throw new ServiceUnavailableException('translation_failed');
    }
  }

  private async translateLocally(text: string, targetLang: string, sourceLang: string | null) {
    try {
      const srcLang = this.mapToM2mLanguage(sourceLang) ?? this.detectSourceLanguage(text) ?? 'en';
      const tgtLang = this.mapToM2mLanguage(targetLang) ?? 'ru';
      const translated = await this.sendToArgos(text, srcLang, tgtLang);
      return {
        text: translated,
        targetLang,
        sourceLang: srcLang,
        provider: 'argos',
        model: 'argos-translate',
      };
    } catch (error) {
      this.logger.error(`[local-translation] failed: ${(error as Error)?.message ?? error}`);
      throw new ServiceUnavailableException('translation_failed');
    }
  }

  private async sendToArgos(text: string, sourceLang: string, targetLang: string): Promise<string> {
    await this.ensureArgosWorker();
    if (!this.argosWorker) {
      throw new Error('argos_not_available');
    }
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('argos_timeout'));
      }, this.argosTimeoutMs);

      this.argosQueue.push({ resolve, reject, timeout });
      const payload = JSON.stringify({
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      });
      this.argosWorker?.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private async ensureArgosWorker(): Promise<void> {
    if (this.argosWorker) {
      return;
    }
    this.logger.log(`Starting Argos worker via ${this.argosPython}`);
    const worker = spawn(this.argosPython, [this.argosWorkerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    worker.stdout.on('data', (chunk) => this.handleArgosData(chunk));
    worker.stderr.on('data', (chunk) => {
      const msg = chunk.toString('utf8').trim();
      if (msg) {
        this.logger.warn(`[Argos stderr] ${msg}`);
      }
    });
    worker.on('exit', (code, signal) => {
      this.logger.error(`Argos worker exited code=${code} signal=${signal}`);
      this.rejectPending(new Error('argos_worker_exit'));
      this.argosWorker = null;
      this.argosBuffer = '';
    });
    worker.on('error', (err) => {
      this.logger.error(`Argos worker error: ${err?.message ?? err}`);
      this.rejectPending(err instanceof Error ? err : new Error(String(err)));
      this.argosWorker = null;
      this.argosBuffer = '';
    });
    this.argosWorker = worker;
  }

  private teardownArgosWorker(): void {
    if (this.argosWorker) {
      this.argosWorker.kill();
      this.argosWorker = null;
    }
    this.rejectPending(new Error('argos_worker_destroyed'));
  }

  private handleArgosData(chunk: Buffer): void {
    this.argosBuffer += chunk.toString('utf8');
    for (;;) {
      const idx = this.argosBuffer.indexOf('\n');
      if (idx === -1) {
        break;
      }
      const line = this.argosBuffer.slice(0, idx).trim();
      this.argosBuffer = this.argosBuffer.slice(idx + 1);
      if (!line) {
        continue;
      }
      const entry = this.argosQueue.shift();
      if (!entry) {
        continue;
      }
      clearTimeout(entry.timeout);
      try {
        const payload = JSON.parse(line) as { text?: string; error?: string };
        if (payload.error) {
          entry.reject(new Error(payload.error));
        } else {
          entry.resolve((payload.text ?? '').trim());
        }
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private rejectPending(error: Error): void {
    while (this.argosQueue.length) {
      const entry = this.argosQueue.shift();
      if (entry) {
        clearTimeout(entry.timeout);
        entry.reject(error);
      }
    }
  }

  private buildPrompt(text: string, targetLang: string, sourceLang: string | null): string {
    const targetLabel = this.languageLabel(targetLang);
    const sourceLabel = sourceLang ? this.languageLabel(sourceLang) : 'original language';
    return [
      `You are a professional technical translator for job postings.`,
      `Translate the following ${sourceLabel} text into ${targetLabel}.`,
      `Preserve the meaning, formatting with bullet points, currencies, and company names.`,
      `Do not prepend explanations; output only the translated text.`,
      `<TEXT>`,
      text,
      `</TEXT>`,
      '<END_TRANSLATION>',
    ].join('\n');
  }

  private languageLabel(code: string): string {
    const normalized = code.toLowerCase();
    if (normalized.startsWith('ru')) return 'Russian';
    if (normalized.startsWith('en')) return 'English';
    if (normalized.startsWith('de')) return 'German';
    if (normalized.startsWith('fr')) return 'French';
    if (normalized.startsWith('es')) return 'Spanish';
    if (normalized.startsWith('uk')) return 'Ukrainian';
    if (normalized.startsWith('pl')) return 'Polish';
    if (normalized.startsWith('pt')) return 'Portuguese';
    if (normalized.startsWith('zh')) return 'Chinese';
    return code;
  }

  private stripStopTokens(text: string): string {
    return text.replace(/<END_TRANSLATION>$/i, '').trim();
  }

  private parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) {
      return defaultValue;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  private mapToM2mLanguage(input: string | null | undefined): string | null {
    if (!input) {
      return null;
    }
    const normalized = input.trim().toLowerCase();
    const map: Record<string, string> = {
      ru: 'ru',
      en: 'en',
      de: 'de',
      fr: 'fr',
      es: 'es',
      it: 'it',
      pt: 'pt',
      pl: 'pl',
      uk: 'uk',
      tr: 'tr',
      cs: 'cs',
      sk: 'sk',
      ro: 'ro',
      hu: 'hu',
      zh: 'zh',
      ja: 'ja',
      ko: 'ko',
    };
    for (const key of Object.keys(map)) {
      if (normalized.startsWith(key)) {
        return map[key];
      }
    }
    return null;
  }

  private detectSourceLanguage(text: string): string | null {
    const sample = text.slice(0, 500);
    if (/[А-Яа-яЁё]/.test(sample)) {
      return 'ru';
    }
    if (/[ÄÖÜäöüß]/.test(sample)) {
      return 'de';
    }
    if (/[éèêàçùâîôûëïüÿœæ]/i.test(sample)) {
      return 'fr';
    }
    if (/[ñáéíóúü¡¿]/i.test(sample)) {
      return 'es';
    }
    if (/[ąćęłńóśźż]/i.test(sample)) {
      return 'pl';
    }
    if (/[ìíîïòóôõùúûü]/i.test(sample)) {
      return 'it';
    }
    if (/[ăâîșț]/i.test(sample)) {
      return 'ro';
    }
    return 'en';
  }
}
