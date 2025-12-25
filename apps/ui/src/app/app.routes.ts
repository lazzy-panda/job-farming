import { Route } from '@angular/router';
import { DashboardPageComponent } from './components/dashboard-page/dashboard-page.component';
import { SourcePageComponent } from './components/source-page/source-page.component';
import { SettingsPageComponent } from './components/settings-page/settings-page.component';
import { TemplatesPageComponent } from './components/templates-page/templates-page.component';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    component: DashboardPageComponent,
  },
  {
    path: 'sources/new',
    component: SourcePageComponent,
  },
  {
    path: 'settings',
    component: SettingsPageComponent,
  },
  {
    path: 'templates',
    component: TemplatesPageComponent,
  },
  {
    path: '**',
    redirectTo: '',
  },
];
