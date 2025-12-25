import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';

type ResumeEntry = { id: string; title: string; content: string };
type LetterEntry = { id: string; title: string; channel: 'email' | 'telegram'; content: string };
type ResumeForm = { title: string; content: string };
type LetterForm = { title: string; channel: 'email' | 'telegram'; content: string };

interface TemplateSet {
  id: string;
  name: string;
  resumes: ResumeEntry[];
  letters: LetterEntry[];
  selectedResumeId?: string;
  selectedLetterId?: string;
}

@Component({
  standalone: true,
  selector: 'app-templates-page',
  templateUrl: './templates-page.component.html',
  styleUrl: './templates-page.component.scss',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    DashboardHeaderComponent,
  ],
})
export class TemplatesPageComponent implements OnInit {
  public readonly templateSets = signal<TemplateSet[]>([
    {
      id: 'set-1',
      name: 'Набор 1 (Frontend)',
      resumes: [{ id: 'cv-1', title: 'CV Frontend', content: 'Ссылка или текст резюме' }],
      letters: [
        {
          id: 'lt-1',
          title: 'Email EN',
          channel: 'email',
          content: 'Hi, I am interested in your Frontend role...',
        },
      ],
      selectedResumeId: 'cv-1',
      selectedLetterId: 'lt-1',
    },
  ]);

  public pendingResumes: Record<string, ResumeForm> = {};
  public pendingLetters: Record<string, LetterForm> = {};

  private readonly snack = inject(MatSnackBar);

  public ngOnInit(): void {
    this.templateSets().forEach((set) => this.ensurePending(set.id));
  }

  public addResume(setId: string): void {
    this.ensurePending(setId);
    const form = this.pendingResumes[setId];
    if (!form.title || !form.content) {
      this.snack.open('Резюме: заполните название и содержание', 'OK', { duration: 2000 });
      return;
    }
    const nextSets = this.templateSets().map((set) =>
      set.id === setId
        ? {
            ...set,
            resumes: [...set.resumes, { id: this.createId(), title: form.title, content: form.content }],
          }
        : set,
    );
    this.templateSets.set(nextSets);
    this.updatePendingResume(setId, { title: '', content: '' });
    this.snack.open('Резюме добавлено', 'OK', { duration: 2000 });
  }

  public addLetter(setId: string): void {
    this.ensurePending(setId);
    const form = this.pendingLetters[setId];
    if (!form.title || !form.content) {
      this.snack.open('Письмо: заполните название и текст', 'OK', { duration: 2000 });
      return;
    }
    const nextSets = this.templateSets().map((set) =>
      set.id === setId
        ? {
            ...set,
            letters: [
              ...set.letters,
              { id: this.createId(), title: form.title, channel: form.channel, content: form.content },
            ],
          }
        : set,
    );
    this.templateSets.set(nextSets);
    this.updatePendingLetter(setId, { title: '', channel: 'email', content: '' });
    this.snack.open('Шаблон письма добавлен', 'OK', { duration: 2000 });
  }

  public selectResume(setId: string, resumeId: string): void {
    this.templateSets.set(
      this.templateSets().map((set) => (set.id === setId ? { ...set, selectedResumeId: resumeId } : set)),
    );
    this.snack.open('Резюме выбрано для откликов', 'OK', { duration: 1500 });
  }

  public selectLetter(setId: string, letterId: string): void {
    this.templateSets.set(
      this.templateSets().map((set) => (set.id === setId ? { ...set, selectedLetterId: letterId } : set)),
    );
    this.snack.open('Письмо выбрано для откликов', 'OK', { duration: 1500 });
  }

  public updatePendingResume(setId: string, value: { title: string; content: string }): void {
    this.pendingResumes[setId] = value;
  }

  public updatePendingLetter(setId: string, value: { title: string; channel: 'email' | 'telegram'; content: string }): void {
    this.pendingLetters[setId] = value;
  }

  public trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  private createId(): string {
    return Math.random().toString(36).slice(2, 9);
  }

  private ensurePending(setId: string): void {
    if (!this.pendingResumes[setId]) {
      this.pendingResumes[setId] = { title: '', content: '' };
    }
    if (!this.pendingLetters[setId]) {
      this.pendingLetters[setId] = { title: '', channel: 'email', content: '' };
    }
  }
}


