# AccountMap

*NOTE: THIS PROJECT WAS A HOBBY PROJECT AND HENCE WAS VIBECODED*

*"Which Gmail did I use for this?" — answered in under 5 seconds.*

A local-first, offline, encrypted PWA for tracking which Gmail/work account
you used on which website. No server, no accounts, no analytics, no build
step — plain HTML/CSS/JS.

## Running it

You need to **serve it over HTTP(S)**, not open `index.html` directly as a
`file://` URL — the service worker (for offline use) and the File System
Access API (for backup-folder sync) won't work over `file://`.

Locally, from this folder:

```
python3 -m http.server 8080
```

Then visit `http://localhost:8080`. On your phone, host it somewhere with
real HTTPS — GitHub Pages, Cloudflare Pages, Netlify, or your own server —
then open it in Chrome on Android and use **⋮ → Add to Home screen** to
install it as an app.

## How your data is protected

- The first time you open the app, you set a **passphrase**. Everything —
  every account, platform, and link — is encrypted with a key derived from
  that passphrase (PBKDF2-SHA256, 250,000 iterations → AES-256-GCM).
- The derived key exists **only in memory**, only while the vault is
  unlocked. It's never written to disk. Lock the vault (or leave the app
  idle for 20 minutes) and the key is gone — the passphrase must be
  re-entered to decrypt anything again.
- There is **no password reset**. Nobody — including you, if you forget it —
  can recover a vault without the passphrase. That's the trade-off for there
  being no server that could leak it.
- Nothing ever leaves your device. There's no backend to talk to.

## How your data survives "clear browsing data"

This is the part worth understanding, because it's a genuine constraint of
the web platform rather than something an app can fully paper over:

Your day-to-day copy lives in **IndexedDB**, which is "site data" — the
same bucket a browser's "Clear browsing data" wipes. The app calls
`navigator.storage.persist()` on first run to ask the browser not to evict
it automatically under storage pressure, but that's a request, not a
guarantee, and it does nothing against a manual clear.

So AccountMap also writes **real encrypted files**, outside that sandbox:

- **Back up now** (Settings) downloads an encrypted `.accountmap.json` file
  to your device's actual Downloads folder — a real file, untouched by
  clearing the browser. This works in every browser, including Android
  Chrome.
- **On desktop Chrome/Edge**, you can additionally connect a real folder
  (via the File System Access API) once, and the app will silently write a
  fresh encrypted backup into it after every change — no more manual
  exports needed. This API doesn't exist on Android Chrome yet, so on phone
  the manual download is the durable path.
- A banner nudges you to back up if it's been a few days since the last one
  and something has changed.
- **Restore from backup** (Settings, or "Restore from a backup file instead"
  on the lock screen) decrypts one of these files back into the app — useful
  after clearing data, switching browsers, or moving to a new device.

Every backup file is encrypted with the same passphrase-derived key as the
live vault — a stolen backup file is as useless as a stolen IndexedDB
database without the passphrase.

## What's in the data model

- **Accounts** — a Gmail/work email, display name, type, organization, tags, notes.
- **Platforms** — a website/service, URL, category, tags, notes.
- **Connections** — the many-to-many link between the two: login method,
  purpose/client, project, notes.

Search matches across all three, so searching a client name surfaces every
account and platform tied to it, not just exact matches.

## Also included

- CSV export/import (`platform, email, login_method, purpose, project, notes`)
  for spreadsheets or migrating away — this one is plain-text, by design, so
  you're never locked in.
- A change-passphrase flow that re-encrypts the whole vault.
- An "Erase vault" danger-zone action, gated behind typing a confirmation.

## Structure

```
index.html          app shell (single page, all views)
css/styles.css       design tokens + components
js/crypto.js         PBKDF2 + AES-GCM
js/db.js             IndexedDB wrapper (vault blob + folder handle)
js/store.js          in-memory state, CRUD, search, stats
js/backup.js         file download / File System Access folder sync
js/ui.js             rendering + modals
js/app.js            bootstrap, lock screen, nav, idle auto-lock
manifest.json, sw.js  PWA install + offline caching
fonts/                self-hosted Space Grotesk + Space Mono (no CDN dependency)
```

