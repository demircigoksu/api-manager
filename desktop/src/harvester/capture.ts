// Pure helpers shared by the harvester engine; no Electron imports so they
// stay unit-testable.

export const DEFAULT_SIGNED_IN_SCRIPT = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  if (Array.from(document.querySelectorAll('input[type=password]')).some(vis)) return false;
  return !Array.from(document.querySelectorAll('button, a, [role=button]')).some((b) => vis(b) && /^(sign in|log in|login|continue with (google|github|email)|giriş yap|oturum aç)$/i.test((b.innerText || '').trim()));
})()`;

/**
 * Picks the key out of what the sign-in window saw: the copied text wins when
 * it is (or contains) a key, then a key visible on the page. Without a
 * provider pattern only a copied, key-shaped string counts.
 */
export function pickCapturedKey(clip: string, page: string | null, keyRe: RegExp | null): string | null {
  const c = clip.trim();
  if (c) {
    if (keyRe) {
      const m = c.match(keyRe);
      if (m) return m[0];
    } else if (/^[A-Za-z0-9_\-.:]{20,300}$/.test(c) && !/^https?:/i.test(c) && !c.includes('@')) {
      return c;
    }
  }
  return page && keyRe && keyRe.test(page) ? page : null;
}

