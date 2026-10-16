// Built to build/preload.cjs (CommonJS — the reliable preload format).
// Runs in the renderer before any page script: seeds the dashboard session
// token into localStorage so AuthGate's very first /api/auth/status call is
// authenticated. The token arrives via additionalArguments (process.argv),
// which avoids templating strings into executeJavaScript.
import { contextBridge, ipcRenderer } from 'electron';

const TOKEN_KEY = 'freellmapi_dashboard_token';
const arg = process.argv.find((a) => a.startsWith('--freeapi-token='));
if (arg) {
  try {
    window.localStorage.setItem(TOKEN_KEY, arg.slice('--freeapi-token='.length));
  } catch {
    // localStorage unavailable — the dashboard will show its login screen.
  }
}

// Lets the client adapt its chrome (drag region, traffic-light padding,
// no Sign out) when running inside the desktop shell.
contextBridge.exposeInMainWorld('__FREEAPI_DESKTOP__', true);
contextBridge.exposeInMainWorld('__FREEAPI_PLATFORM__', process.platform);

// The dashboard window signs in as the hidden machine account, whose password
// is random and never shown, so it must never land on the login form. When the
// seeded session is gone (expired after 30 days of uptime, or cleared by a 401)
// AuthGate asks the main process for a fresh one instead. Exposed as a bare
// function rather than a broader bridge: the renderer loads http://127.0.0.1,
// and every extra capability handed to that world is one an XSS could use —
// this one only ever hands back a session for the account the window already
// runs as.
contextBridge.exposeInMainWorld('__FREEAPI_SESSION__', () => ipcRenderer.invoke('freeapi:session-token'));

// The running build's version, so the dashboard can show which one it is and
// offer a check against the published releases (#703). Arrives the same way the
// token does; absent in a browser, where the dashboard simply omits the row
// rather than guessing from the server's own (unrelated) package version.
const versionArg = process.argv.find((a) => a.startsWith('--freeapi-version='));
contextBridge.exposeInMainWorld(
  '__FREEAPI_VERSION__',
  versionArg ? versionArg.slice('--freeapi-version='.length) : null,
);

// The in-app updater (the Settings update dialog and the update reminder). Like the session bridge above, deliberately
// narrow: it can only check for, download and install the release published at
// demircigoksu/api-manager — the feed URL and signature checks live in the main
// process and nothing here can point them anywhere else.
contextBridge.exposeInMainWorld('__FREEAPI_UPDATER__', {
  state: () => ipcRenderer.invoke('freeapi:update-state'),
  check: () => ipcRenderer.invoke('freeapi:update-check'),
  download: () => ipcRenderer.invoke('freeapi:update-download'),
  install: () => ipcRenderer.invoke('freeapi:update-install'),
  subscribe: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state);
    ipcRenderer.on('freeapi:update-state', handler);
    return () => { ipcRenderer.removeListener('freeapi:update-state', handler); };
  },
});

// Key harvester (Keys page, "Anahtar Toplayıcı" tab). Narrow on purpose: the
// dashboard can list providers, start sign-in windows and harvests, and store
// a password, but never read one back.
contextBridge.exposeInMainWorld('__FREEAPI_HARVESTER__', {
  list: () => ipcRenderer.invoke('freeapi:harvester:list'),
  harvest: (id: string) => ipcRenderer.invoke('freeapi:harvester:harvest', id),
  harvestAll: () => ipcRenderer.invoke('freeapi:harvester:harvest-all'),
  login: (id: string) => ipcRenderer.invoke('freeapi:harvester:login', id),
  check: (id: string) => ipcRenderer.invoke('freeapi:harvester:check', id),
  logout: (id: string) => ipcRenderer.invoke('freeapi:harvester:logout', id),
  setCredentials: (id: string, email: string, password: string) => ipcRenderer.invoke('freeapi:harvester:set-credentials', id, email, password),
  clearCredentials: (id: string) => ipcRenderer.invoke('freeapi:harvester:clear-credentials', id),
  setAutoRefresh: (id: string, on: boolean) => ipcRenderer.invoke('freeapi:harvester:set-auto', id, on),
  reloadRecipes: () => ipcRenderer.invoke('freeapi:harvester:reload-recipes'),
  openRecipesFolder: () => ipcRenderer.invoke('freeapi:harvester:open-recipes-folder'),
  subscribe: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on('freeapi:harvester-changed', handler);
    return () => { ipcRenderer.removeListener('freeapi:harvester-changed', handler); };
  },
});

// Local tab: LLM servers on this machine and AI CLIs on PATH.
contextBridge.exposeInMainWorld('__FREEAPI_LOCAL__', {
  servers: () => ipcRenderer.invoke('freeapi:local:servers'),
  registerServer: (baseUrl: string, name: string) => ipcRenderer.invoke('freeapi:local:register-server', baseUrl, name),
  clis: () => ipcRenderer.invoke('freeapi:local:clis'),
  connectCli: (id: string) => ipcRenderer.invoke('freeapi:local:connect-cli', id),
});

// `desktop` class on <html> identifies the desktop shell. On macOS, `desktop-mac`
// activates the translucent glass backdrop that pairs with native vibrancy;
// on Windows and Linux, the solid theme background is preserved so contrast and
// readability remain intact.
function applyDesktopClass() {
  document.documentElement?.classList.add('desktop');
  if (process.platform === 'darwin') {
    document.documentElement?.classList.add('desktop-mac');
  }
}
try {
  applyDesktopClass();
} catch {
  // Document not ready — DOMContentLoaded below covers it.
}

// Mirror the dashboard's theme to the main process so the tray popover
// matches. The dashboard expresses its resolved theme as the `dark` class
// and the underlying choice (dark/light/system) as `data-theme-choice`,
// both on documentElement — observe those rather than reaching across
// worlds into localStorage. The choice lets the main process hand
// nativeTheme.themeSource back to the OS when the user picks System.
function reportTheme() {
  ipcRenderer.send('freeapi:theme-changed', {
    resolved: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    choice: document.documentElement.dataset.themeChoice,
  });
}

// Mirror the dashboard's locale to the main process so the native tray menu and
// the popover match. The I18nProvider sets `<html lang>` on every locale change,
// so observe that attribute rather than reaching into the dashboard's
// localStorage from this preload world.
function reportLocale() {
  const lang = document.documentElement.lang;
  if (lang) ipcRenderer.send('freeapi:locale-changed', lang);
}
window.addEventListener('DOMContentLoaded', () => {
  applyDesktopClass();
  reportTheme();
  reportLocale();
  new MutationObserver(() => {
    reportTheme();
    reportLocale();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'lang', 'data-theme-choice'],
  });
});
