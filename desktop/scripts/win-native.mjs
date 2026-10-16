// Puts the Windows x64 prebuilt better-sqlite3 binary for this Electron into
// node_modules, so `electron-builder --win` can cross-build from Linux/macOS
// with npmRebuild disabled. Run `npm run rebuild:native` afterwards to get the
// host binary back for `npm run dev`.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const moduleDir = path.join(here, '..', 'node_modules', 'better-sqlite3');
const bin = path.join(here, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'prebuild-install.cmd' : 'prebuild-install');

execFileSync(bin, ['--runtime', 'electron', '--target', electronVersion, '--arch', 'x64', '--platform', 'win32', '--force'], {
  cwd: moduleDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log(`win-native: better-sqlite3 for Electron ${electronVersion} win32-x64 in place`);
