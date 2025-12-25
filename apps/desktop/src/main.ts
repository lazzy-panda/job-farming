/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { app, BrowserWindow } from 'electron';
import { join } from 'path';

const isDev = process.env.NODE_ENV !== 'production';
const rendererUrl =
  process.env.RENDERER_URL || 'http://localhost:4200';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await win.loadURL(rendererUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(join(__dirname, 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
