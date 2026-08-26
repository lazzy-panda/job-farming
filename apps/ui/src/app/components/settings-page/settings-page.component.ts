import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../api.service';
import { SettingsFormComponent } from '../settings-form/settings-form.component';
import { DashboardHeaderComponent } from '../dashboard-header/dashboard-header.component';

@Component({
  standalone: true,
  selector: 'app-settings-page',
  imports: [CommonModule, MatSnackBarModule, SettingsFormComponent, DashboardHeaderComponent],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent implements OnInit {
  public readonly settings = signal<Record<string, string | number>>({});

  private readonly api = inject(ApiService);
  private readonly snack = inject(MatSnackBar);

  public ngOnInit(): void {
    this.loadSettings();
  }

  public loadSettings(): void {
    this.api.getSettings().subscribe((res) => {
      this.settings.set((res as Record<string, string | number>) || {});
    });
  }

  public saveSettings(settingsPayload: Record<string, string | number>): void {
    this.api.saveSettings(settingsPayload).subscribe({
      next: () => this.snack.open('Настройки сохранены', 'OK', { duration: 2000 }),
      error: () => this.snack.open('Ошибка сохранения настроек', 'OK', { duration: 2000 }),
    });
  }
}


