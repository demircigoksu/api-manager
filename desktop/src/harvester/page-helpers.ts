// JavaScript source injected in front of every recipe script. It runs in the
// provider's page (main world, no Node access) and gives recipes a small,
// stable toolkit so they stay short and readable.
//
// Selectors: a CSS selector, or `text=Create API Key` to match the visible text
// of a button/link/menu item (case-insensitive, trimmed, exact first, then
// "starts with").

export const PAGE_HELPERS = String.raw`
const h = (() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], input[type="submit"], input[type="button"], label, summary';
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function findAll(sel, root) {
    root = root || document;
    if (sel.startsWith('text=')) {
      const want = norm(sel.slice(5));
      const els = Array.from(root.querySelectorAll(CLICKABLE)).filter(visible);
      const exact = els.filter((e) => norm(e.innerText || e.value) === want);
      if (exact.length) return exact;
      return els.filter((e) => norm(e.innerText || e.value).startsWith(want));
    }
    return Array.from(root.querySelectorAll(sel)).filter(visible);
  }
  function find(sel, root) {
    return findAll(sel, root)[0] || null;
  }
  async function waitFor(sel, opts) {
    const timeout = (opts && opts.timeout) || 20000;
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = find(sel);
      if (el) return el;
      await sleep(200);
    }
    throw new Error('Element not found: ' + sel);
  }
  async function waitGone(sel, opts) {
    const end = Date.now() + ((opts && opts.timeout) || 20000);
    while (Date.now() < end) {
      if (!find(sel)) return;
      await sleep(200);
    }
    throw new Error('Element still visible: ' + sel);
  }
  async function click(sel, opts) {
    const el = await waitFor(sel, opts);
    el.scrollIntoView({ block: 'center' });
    el.click();
    await sleep((opts && opts.after) || 400);
    return el;
  }
  // React/Vue keep their own copy of an input's value; going through the
  // native setter and firing input/change is what makes them notice.
  async function fill(sel, value, opts) {
    const el = await waitFor(sel, opts);
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    return el;
  }
  async function fetchJson(url, init) {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, init || {}));
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url + ': ' + text.slice(0, 200));
    try { return JSON.parse(text); } catch { return text; }
  }
  // Searches inputs, code blocks and visible text for something that looks
  // like the key. Returns the first match or throws after the timeout.
  async function readKey(pattern, opts) {
    const re = new RegExp(pattern);
    const end = Date.now() + ((opts && opts.timeout) || 20000);
    while (Date.now() < end) {
      for (const el of document.querySelectorAll('input, textarea')) {
        const m = (el.value || '').match(re);
        if (m) return m[0];
      }
      for (const el of document.querySelectorAll('code, pre, [data-testid], span, div, p')) {
        if (el.children.length > 2) continue;
        const m = (el.textContent || '').match(re);
        if (m) return m[0];
      }
      if (window.__harvestClipboard) {
        const m = window.__harvestClipboard.match(re);
        if (m) return m[0];
      }
      await sleep(250);
    }
    throw new Error('The new key did not appear on the page');
  }
  // Records what the page copies, for sites that only offer a Copy button.
  function captureClipboard() {
    try {
      const orig = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : null;
      navigator.clipboard.writeText = (t) => {
        window.__harvestClipboard = String(t);
        return orig ? orig(t).catch(() => {}) : Promise.resolve();
      };
    } catch {}
    document.addEventListener('copy', () => {
      try { window.__harvestClipboard = String(getSelection()); } catch {}
    }, true);
  }
  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const keyName = 'freellmapi-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  return { sleep, find, findAll, waitFor, waitGone, click, fill, fetchJson, readKey, captureClipboard, cookie, keyName };
})();
`;

/** Wraps a recipe body so executeJavaScript always resolves to a plain result. */
export function wrapRecipeScript(body: string, args: Record<string, unknown> = {}): string {
  return `(async () => {
${PAGE_HELPERS}
const args = ${JSON.stringify(args)};
try {
  const out = await (async () => {
${body}
  })();
  return { ok: true, value: out };
} catch (e) {
  return { ok: false, error: String((e && e.message) || e) };
}
})()`;
}
