// Written into <userData>/recipes/README.md on first run.
export const RECIPES_README = `# Anahtar Toplayıcı tarifleri / Key Harvester recipes

Bu klasördeki her \`<id>.json\` dosyası, uygulamayla gelen aynı id'li tarifin
yerine geçer. Dosyayı kaydettikten sonra panelde "Tarifleri yeniden yükle"ye basın.

Every \`<id>.json\` file in this folder replaces the bundled recipe with the same
id. Press "Reload recipes" in the dashboard after saving.

\`\`\`json
{
  "id": "groq",
  "name": "Groq",
  "target": { "kind": "platform", "platform": "groq" },
  "loginUrl": "https://console.groq.com/login",
  "keysUrl": "https://console.groq.com/keys",
  "signedInUrlPattern": "^https://console\\\\.groq\\\\.com/keys",
  "keyPattern": "^gsk_[A-Za-z0-9]{20,}$",
  "verified": true,
  "autoLogin": [
    { "type": "fill", "selector": "input[type=email]", "value": "email" },
    { "type": "fill", "selector": "input[type=password]", "value": "password" },
    { "type": "click", "selector": "text=Sign in" }
  ],
  "createKey": "h.captureClipboard(); await h.click('text=Create API Key'); await h.fill('input[name=name]', h.keyName); await h.click('text=Submit'); return await h.readKey('gsk_[A-Za-z0-9]{20,}');"
}
\`\`\`

- \`target\`: \`{ "kind": "platform", "platform": "<router platform id>" }\` or
  \`{ "kind": "custom", "baseUrl": "https://.../v1", "models": ["..."] }\`.
- \`createKey\`: body of an async function run inside \`keysUrl\`. It must
  \`return\` the key string (Cloudflare: \`{ "key": "...", "accountId": "..." }\`).
- Helpers available as \`h\`: \`click(sel)\`, \`fill(sel, value)\`, \`waitFor(sel)\`,
  \`waitGone(sel)\`, \`find(sel)\`, \`fetchJson(url, init)\` (same-origin, with
  cookies), \`readKey(regex)\`, \`captureClipboard()\`, \`cookie(name)\`,
  \`sleep(ms)\`, \`keyName\`. A selector is CSS or \`text=Button text\`.
- \`autoLogin\` steps: \`goto\`, \`fill\` (value \`email\` or \`password\`), \`click\`,
  \`wait\`, \`waitFor\`. Passwords are stored with Windows DPAPI and only ever
  typed into the provider's own login page.
`;
