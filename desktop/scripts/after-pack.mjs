// electron-builder afterPack: runs once per platform after the app is staged
// and before installers/portable archives are made (and before signing).
//
// 1. Linux: chrome-sandbox must be setuid (see after-pack-linux-sandbox.mjs).
// 2. Every platform: flip Electron's security fuses. The key harvester keeps
//    provider sessions in this app's cookie store, so cookies are encrypted at
//    rest with the OS key store, and the binary refuses to be reused as a
//    plain Node.js runtime or debugged through environment variables.
import fs from 'node:fs';
import path from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import * as ResEdit from 'resedit';
import linuxSandboxAfterPack from './after-pack-linux-sandbox.mjs';

export const HARDENED_FUSES = {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
};

export function electronBinaryPath(context) {
  const name = context.packager.appInfo.productFilename;
  switch (context.electronPlatformName) {
    case 'darwin':
    case 'mas':
      return path.join(context.appOutDir, `${name}.app`);
    case 'win32':
      return path.join(context.appOutDir, `${name}.exe`);
    default:
      return path.join(context.appOutDir, context.packager.executableName);
  }
}

// Windows: set the exe icon and version info in pure JS. electron-builder does
// this with rcedit, which needs Wine when building on Linux/macOS; with
// win.signAndEditExecutable off, this keeps cross-built .exe files branded.
export async function brandWindowsExe(context) {
  const exe = electronBinaryPath(context);
  const { appInfo } = context.packager;
  const data = fs.readFileSync(exe);
  const executable = ResEdit.NtExecutable.from(data);
  const res = ResEdit.NtExecutableResource.from(executable);

  const iconPath = await context.packager.getIconPath();
  if (iconPath && iconPath.endsWith('.ico')) {
    const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const groupId = groups.length > 0 ? groups[0].id : 1;
    const lang = groups.length > 0 ? groups[0].lang : 1033;
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  }

  const [ver] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (ver) {
    const parts = appInfo.version.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
    const [a = 0, b = 0, c = 0] = parts;
    ver.setFileVersion(a, b, c, 0, 1033);
    ver.setProductVersion(a, b, c, 0, 1033);
    ver.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      CompanyName: appInfo.companyName ?? '',
      LegalCopyright: appInfo.copyright ?? '',
      OriginalFilename: `${appInfo.productFilename}.exe`,
      InternalName: appInfo.productFilename,
    });
    ver.outputToResourceEntries(res.entries);
  }
  res.outputResource(executable);
  fs.writeFileSync(exe, Buffer.from(executable.generate()));
}

export default async function afterPack(context) {
  await linuxSandboxAfterPack(context);
  if (context.electronPlatformName === 'win32') await brandWindowsExe(context);
  await flipFuses(electronBinaryPath(context), {
    ...HARDENED_FUSES,
    // macOS re-signs after this hook; tell the flipper not to ad-hoc sign.
    resetAdHocDarwinSignature: context.electronPlatformName === 'darwin' && context.arch === 3 /* arm64 */,
  });
}
