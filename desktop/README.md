# Api Manager Desktop

Lean Electron menu-bar app for [Api Manager](https://github.com/demircigoksu/api-manager), a fork of [freellmapi](https://github.com/tashfeenahmed/freellmapi):
runs the whole router locally on `127.0.0.1:31415`, with a dark-glass tray
popover (live 24h request chart, quick stats, copy URL/key) and the full
dashboard in a native-feeling window.

Download the portable Windows `.exe` from [Releases](https://github.com/demircigoksu/api-manager/releases/latest),
or build against the server and client sources in this checkout.

A macOS build made from source supports **arm64** (Apple Silicon) and **x64**
(Intel) on **macOS 12 Monterey or later**, as a DMG and a ZIP.

## Prerequisites

- Node.js 20+
- A native build toolchain for `better-sqlite3`:
  - **macOS** — Xcode Command Line Tools (`xcode-select --install`) and Python 3
  - **Windows** — Visual Studio Build Tools ("Desktop development with C++")

## Build it yourself

From the **repo root** (one-time client build + package):

```bash
npm install
npm install --prefix desktop  # install desktop dependencies
npm run desktop:dist          # macOS → desktop/dist-electron/FreeLLMAPI-…-arm64.dmg
npm run desktop:dist:mac:x64  # Intel Mac → desktop/dist-electron/FreeLLMAPI-…-x64.dmg
npm run desktop:dist:win      # Windows → desktop/dist-electron/FreeLLMAPI-…-x64 installer
```

Both Mac commands also produce a ZIP. Prefer building on the matching Mac
architecture so `better-sqlite3` can be rebuilt and tested natively. The release
workflow does this in separate Apple Silicon and Intel jobs, signs/notarizes
both, then verifies their final checksums and publishes one combined
`latest-mac.yml`.

> Locally built apps don't carry the macOS quarantine attribute or Windows
> Mark-of-the-Web, so they launch without Gatekeeper/SmartScreen warnings —
> no code signing needed.
>
> The Windows build is config-complete but largely untested — issues and PRs
> welcome.

## Develop

```bash
cd desktop
npm install
npm run rebuild:native   # better-sqlite3 against Electron's ABI (dev loop only)
npm run dev              # bundle + launch
```

The dev run serves the repo's own `client/dist` — build it first
(`npm run build -w client` from the root) or use `npm run desktop:dev` from
the root, which does both. `FREEAPI_REPO=/path/to/checkout` overrides the
client/server source location if you ever need a different one.

UI iteration helpers (dev only): `FREEAPI_SHOT=1 npx electron .` captures the
popover + dashboard to /tmp and quits; `FREEAPI_SHOT=hold` pins the popover
open for real-screen captures.

## Notes

- DB + config live in `~/Library/Application Support/FreeLLMAPI/` (macOS) /
  `%APPDATA%/FreeLLMAPI/` (Windows).
- The server binds loopback only; default port 31415, scan-up on conflict,
  resolved port persisted.
- Do not run plain `npm rebuild` here — it rebuilds better-sqlite3 for the
  system Node ABI and breaks the Electron dev loop (`npm run rebuild:native`
  fixes it). Packaging rebuilds natives itself.
