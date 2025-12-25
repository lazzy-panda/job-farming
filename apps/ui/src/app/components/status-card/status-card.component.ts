import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
  standalone: true,
  selector: 'app-status-card',
  imports: [CommonModule, MatCardModule],
  templateUrl: './status-card.component.html',
  styleUrls: ['./status-card.component.scss'],
})
export class StatusCardComponent {
  @Input() title = 'Статусы';
  @Input() text = 'Health: /api/health';
  @Input() lastScrapedAt?: string;
  @Input() lastMessageId?: number;
  @Input() emptyRuns?: number;
  @Input() stopUntil?: string | null;
  @Input() lastError?: string | null;
}


