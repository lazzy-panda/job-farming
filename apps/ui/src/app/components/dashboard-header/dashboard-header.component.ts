import { CommonModule, NgOptimizedImage } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SortMenuComponent, SortMode } from '../sort-menu/sort-menu.component';

@Component({
  standalone: true,
  selector: 'app-dashboard-header',
  imports: [
    CommonModule,
    NgOptimizedImage,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    SortMenuComponent,
  ],
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss',
})
export class DashboardHeaderComponent {
  @Input() public subtitle: string = '';
  @Input() public showSort: boolean = false;
  @Input() public sortMode: SortMode = 'date_desc';
  @Output() public refresh: EventEmitter<void> = new EventEmitter<void>();
  @Output() public sortChange: EventEmitter<SortMode> = new EventEmitter<SortMode>();
}

