import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

@Component({
  standalone: true,
  selector: 'app-job-search',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
  ],
  templateUrl: './job-search.component.html',
  styleUrl: './job-search.component.scss',
})
export class JobSearchComponent {
  @Input() public query: string = '';
  @Input() public total: number = 0;
  @Input() public filtered: number = 0;

  @Output() public queryChange = new EventEmitter<string>();

  public readonly presets: Array<{ label: string; value: string }> = [
    { label: 'Remote', value: 'удал' },
    { label: 'UX/UI', value: 'ux ui' },
    { label: 'Python', value: 'python' },
    { label: 'Маркетинг', value: 'маркетинг' },
  ];

  public onInput(value: string): void {
    this.queryChange.emit(value ?? '');
  }

  public applyPreset(value: string): void {
    const next = (value ?? '').trim();
    this.queryChange.emit(next);
  }

  public clear(): void {
    this.queryChange.emit('');
  }
}

