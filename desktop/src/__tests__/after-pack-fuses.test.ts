import { describe, expect, it } from 'vitest';
import { FuseV1Options } from '@electron/fuses';
// @ts-expect-error -- plain .mjs build script without type declarations
import { HARDENED_FUSES, electronBinaryPath } from '../../scripts/after-pack.mjs';

describe('after-pack fuses', () => {
  it('hardens the binary the key harvester runs in', () => {
    expect(HARDENED_FUSES[FuseV1Options.RunAsNode]).toBe(false);
    expect(HARDENED_FUSES[FuseV1Options.EnableCookieEncryption]).toBe(true);
    expect(HARDENED_FUSES[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false);
    expect(HARDENED_FUSES[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false);
    expect(HARDENED_FUSES[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true);
  });

  it('targets the right executable per platform', () => {
    const ctx = (platform: string) => ({
      electronPlatformName: platform,
      appOutDir: '/out',
      packager: { appInfo: { productFilename: 'FreeLLMAPI' }, executableName: 'freellmapi' },
    });
    expect(electronBinaryPath(ctx('win32'))).toMatch(/FreeLLMAPI\.exe$/);
    expect(electronBinaryPath(ctx('darwin'))).toMatch(/FreeLLMAPI\.app$/);
    expect(electronBinaryPath(ctx('linux'))).toMatch(/freellmapi$/);
  });
});
