# Key Harvester recipes

The desktop app's Key Harvester (Keys → Key Harvester) drives one recipe per provider.
Bundled recipes live in `desktop/src/harvester/recipes.ts`. A JSON file with the same `id`
in `%APPDATA%\FreeLLMAPI\recipes\` (macOS: `~/Library/Application Support/FreeLLMAPI/recipes/`)
replaces the bundled one; press **Reload recipes** after editing. The folder also contains a
README with the full format.

## How a run works

1. A hidden window with the provider's own browser partition opens `keysUrl`.
2. The session counts as signed in when the URL matches `signedInUrlPattern` and
   `signedInScript` (default: no visible password field or "Sign in" button) is true.
3. If not signed in and a password is saved and `autoLogin` steps exist, they run once.
4. `createKey` runs inside the page with a helper `h` and returns the key
   (Cloudflare: `{ key, accountId }`).
5. The key is checked against `keyPattern`, saved through the router's own API
   (label "Anahtar Toplayıcı"), and a health check is started.

When the health check marks a key invalid, the harvester replaces that key in place
(at most once per provider every 15 minutes) and shows a notification if a person
has to sign in.

## Writing a recipe

Sign in to the provider in a normal browser, open the keys page and watch the network tab
while creating a key. Prefer calling the console's own JSON endpoints with `h.fetchJson`
(same origin, cookies included) over clicking through the DOM: they change less often.
Clean up older keys the app created (`freellmapi-*` names) only after the new key exists.

The helpers: `click`, `fill`, `waitFor`, `waitGone`, `find`, `findAll`, `fetchJson`,
`readKey(regex)`, `captureClipboard()`, `cookie(name)`, `sleep(ms)`, `keyName`.
Selectors are CSS or `text=Visible text`.
