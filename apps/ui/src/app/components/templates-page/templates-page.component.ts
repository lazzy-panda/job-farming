import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Resume, ResumeStats, Template } from '@job-farm/shared-models';
import { ApiService } from '../../api.service';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';
import { JfConfirmService } from '../confirm-dialog/confirm.service';

type ResumeForm = { name: string; title: string; content: string; notes: string };
type LetterForm = { name: string; channel: string; content: string };

const EMPTY_RESUME_FORM: ResumeForm = { name: '', title: '', content: '', notes: '' };
const EMPTY_LETTER_FORM: LetterForm = { name: '', channel: 'telegram', content: '' };

@Component({
  standalone: true,
  selector: 'app-templates-page',
  templateUrl: './templates-page.component.html',
  styleUrl: './templates-page.component.scss',
  imports: [CommonModule, FormsModule, MatSnackBarModule, DashboardHeaderComponent],
})
export class TemplatesPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly confirmDialog = inject(JfConfirmService);

  readonly resumes = signal<Resume[]>([]);
  readonly resumeStats = signal<ResumeStats[]>([]);
  readonly letters = signal<Template[]>([]);

  resumeForm: ResumeForm = { ...EMPTY_RESUME_FORM };
  editingResumeId: string | null = null;

  letterForm: LetterForm = { ...EMPTY_LETTER_FORM };
  editingLetterId: string | null = null;

  readonly letterChannels = ['telegram', 'email', 'hh', 'habr'];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.getResumes().subscribe((r) => this.resumes.set(r));
    this.api.getResumeStats().subscribe((s) => this.resumeStats.set(s));
    this.api.getTemplates().subscribe((t) => this.letters.set(t));
  }

  // --- Резюме ---

  statsFor(resume: Resume): ResumeStats | null {
    return this.resumeStats().find((s) => s.resumeVersion === resume.name) ?? null;
  }

  saveResume(): void {
    const form = this.resumeForm;
    if (!form.name.trim() || !form.title.trim() || !form.content.trim()) {
      this.snack.open('Заполните имя версии, заголовок и текст резюме', 'OK', { duration: 2500 });
      return;
    }
    const payload = {
      name: form.name.trim(),
      title: form.title.trim(),
      content: form.content,
      notes: form.notes.trim() || null,
    };
    const request = this.editingResumeId
      ? this.api.updateResume(this.editingResumeId, payload)
      : this.api.createResume(payload);
    request.subscribe({
      next: () => {
        this.snack.open(this.editingResumeId ? 'Резюме обновлено' : 'Резюме добавлено', 'OK', {
          duration: 2000,
        });
        this.cancelResumeEdit();
        this.reload();
      },
      error: (err) =>
        this.snack.open(err?.error?.message ?? 'Не удалось сохранить резюме', 'OK', {
          duration: 3000,
        }),
    });
  }

  editResume(resume: Resume): void {
    this.editingResumeId = resume.id;
    this.resumeForm = {
      name: resume.name,
      title: resume.title,
      content: resume.content,
      notes: resume.notes ?? '',
    };
  }

  cancelResumeEdit(): void {
    this.editingResumeId = null;
    this.resumeForm = { ...EMPTY_RESUME_FORM };
  }

  setDefaultResume(resume: Resume): void {
    if (resume.isDefault) {
      return;
    }
    this.api.updateResume(resume.id, { isDefault: true }).subscribe(() => {
      this.snack.open(`«${resume.name}» — резюме по умолчанию для откликов`, 'OK', { duration: 2000 });
      this.reload();
    });
  }

  async deleteResume(resume: Resume): Promise<void> {
    if (!(await this.confirmDialog.ask(`Удалить резюме «${resume.name}»?`))) {
      return;
    }
    this.api.deleteResume(resume.id).subscribe(() => {
      if (this.editingResumeId === resume.id) {
        this.cancelResumeEdit();
      }
      this.reload();
    });
  }

  // --- Шаблоны писем ---

  saveLetter(): void {
    const form = this.letterForm;
    if (!form.name.trim() || !form.content.trim()) {
      this.snack.open('Заполните название и текст шаблона', 'OK', { duration: 2500 });
      return;
    }
    const payload = { name: form.name.trim(), channel: form.channel, content: form.content };
    const request = this.editingLetterId
      ? this.api.updateTemplate(this.editingLetterId, payload)
      : this.api.createTemplate(payload);
    request.subscribe({
      next: () => {
        this.snack.open(this.editingLetterId ? 'Шаблон обновлён' : 'Шаблон добавлен', 'OK', {
          duration: 2000,
        });
        this.cancelLetterEdit();
        this.reload();
      },
      error: () => this.snack.open('Не удалось сохранить шаблон', 'OK', { duration: 3000 }),
    });
  }

  editLetter(letter: Template): void {
    this.editingLetterId = letter.id;
    this.letterForm = {
      name: letter.name,
      channel: letter.channel ?? 'telegram',
      content: letter.content,
    };
  }

  cancelLetterEdit(): void {
    this.editingLetterId = null;
    this.letterForm = { ...EMPTY_LETTER_FORM };
  }

  async deleteLetter(letter: Template): Promise<void> {
    if (!(await this.confirmDialog.ask(`Удалить шаблон «${letter.name}»?`))) {
      return;
    }
    this.api.deleteTemplate(letter.id).subscribe(() => {
      if (this.editingLetterId === letter.id) {
        this.cancelLetterEdit();
      }
      this.reload();
    });
  }

  // --- Общее ---

  copyContent(content: string): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(content);
      this.snack.open('Текст скопирован в буфер', 'OK', { duration: 1500 });
    }
  }

  letterPreview(letter: Template): string {
    const text = (letter.content ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 72 ? text.slice(0, 72) + '…' : text;
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
