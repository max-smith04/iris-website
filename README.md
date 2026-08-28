# IRIS

A small personal website for Iris — a silver 2022 Suzuki Swift GL — dressed up as
a Windows XP desktop. It fades in from black with the XP startup sound, has
draggable windows, a Start menu and a My Pictures folder. Visitors can give her a
star rating and rewrite the contents of her glovebox; both land in Postgres.

Plain HTML, CSS and JavaScript. No framework, no bundler, no build step. The only
server-side piece is one Vercel function talking to Neon.

---

## The environment variable

```
DATABASE_URL
```

Use Neon's **pooled** connection string — the host contains `-pooler`. Serverless
functions open a lot of short-lived connections, and the pooler is what stops them
exhausting Postgres' connection slots.

`.env.example` has the shape of it. Never commit the real one; `.env` is gitignored.

---

## Setup

### 1. Neon

1. Create a project at [neon.tech](https://neon.tech).
2. **Connect → Connection string**, tick **Pooled connection**, copy it.
3. The `ratings` table is created automatically the first time the API is hit. If
   you would rather do it by hand, run `sql/schema.sql` in the Neon SQL editor.

### 2. Vercel

```bash
npm i -g vercel        # if you don't have it
vercel link            # or: import the repo at vercel.com/new
vercel env add DATABASE_URL          # paste the pooled string, for all environments
vercel deploy --prod
```

No framework preset and no build command — Vercel serves the static files from the
repo root and turns `api/ratings.js` into a function on its own.

### 3. Running it locally

```bash
npm install
vercel env pull .env.local     # pulls DATABASE_URL down
vercel dev                     # http://localhost:3000
```

`vercel dev` is what you want, because it runs the API alongside the static files.
A plain static server works fine for looking at the desktop, but Rate Me will show
"could not reach the ratings service" — which is a deliberate, handled state, not a
crash.

---

## Layout

```
index.html              the whole desktop: windows, taskbar, Start menu, page copy
css/style.css           XP (Luna Blue) chrome, hand-rolled
js/sound.js             startup + shutdown sounds, and the synthesised error ding
js/desktop.js           boot, window manager, taskbar, Start menu, clock, picture viewer
js/ratings.js           the Rate Me widget
js/glovebox.js          the editable Glovebox.txt
api/ratings.js          GET + POST, Neon, server-side validation and escaping
api/glovebox.js         GET + POST, the shared editable text file
sql/schema.sql          both tables
assets/wallpaper.jpg    the desktop background
assets/pictures/        the three photos (full frame) plus their thumbnails
assets/audio/           startup.mp3, shutdown.mp3
```

---

## The API

`GET /api/ratings`

```json
{ "average": 4.3, "count": 7, "ratings": [
  { "id": 7, "name": "Max", "stars": 5, "comment": "…", "created_at": "2026-08-28T19:51:44.000Z" }
] }
```

`POST /api/ratings` with `{ "name": "Max", "stars": 5, "comment": "optional" }`
returns the same shape, freshly recomputed, with `201`.

The browser validates first, but the server does not trust it:

- `stars` must be a finite number, is rounded, and is **clamped to 1–5**.
- `name` is required, trimmed, control characters stripped, capped at **40** chars.
- `comment` is optional, same cleaning, capped at **500** chars.
- Everything the API returns is **HTML-escaped on the way out**, so a comment full
  of `<script>` comes back as text and renders as text.

That last point matters if you touch `js/ratings.js`: `name` and `comment` are
injected with `innerHTML` *because* they arrive pre-escaped, and the two halves
have to change together. Swap one to `textContent` on its own and visitors will
start seeing `&amp;` in their own comments.

### Glovebox

`GET /api/glovebox`

```json
{ "content": "GLOVEBOX.TXT\n…", "editor": "Max", "updated_at": "2026-08-28T20:47:15.000Z" }
```

`POST /api/glovebox` with `{ "content": "…", "name": "optional" }` saves and
returns the same shape with `201`.

`content` comes back **null** until somebody saves for the first time, which is
the signal for the page to keep the default text written into `tpl-notes`. That
way the default lives in exactly one place and the window still renders instantly
with the database cold or unreachable.

- `content` replaces the file wholesale. It is capped at **4000** chars and keeps
  newlines and tabs while every other control character is stripped. The one
  thing rejected is an entirely blank file.
- `name` is optional and capped at **40** chars.
- Both are HTML-escaped on the way out, same as ratings.

`js/glovebox.js` puts that escaped string into the `<pre>` with `innerHTML`, and
runs it back through a four-line `decode()` for the `<textarea>`, which needs the
real characters. Decoding is safe here *because* the string is already escaped:
parsing `&lt;script&gt;` can only ever produce a text node.

---

## Things worth knowing

**Sound.** `assets/audio/startup.mp3` plays as the black screen lifts and
`assets/audio/shutdown.mp3` plays on Start → Turn Off Computer. To swap either
one, drop a new MP3 in with the same filename — nothing else to change. The error
"ding" on an invalid Rate Me submission is still synthesised in `js/sound.js`; if
you want a file for that too, add it to `FILES` and route `error()` through
`play()` the way `startup()` does.

If a sound file is missing or the browser refuses to play it, `js/sound.js` falls
back to a synthesised stand-in rather than failing — so nothing breaks, it just
sounds wrong.

**Boot.** Half a second of black, then the desktop fades in. Nothing opens on its
own — the desktop icons and the Start menu are the way in.

**The startup sound tries immediately.** It is attempted the moment the page
loads. Most browsers block audio until the visitor has interacted with the page,
so if that attempt is refused the sound is armed on the first click or keypress
instead — it is never muted, it just waits for permission. Audio is on by default;
the tray speaker mutes it and remembers the choice.

**The wallpaper** is `assets/wallpaper.jpg` — your own Bliss composite, dropped in
as-is (just re-encoded progressive to speed up first paint). Replace the file to
change it.

**The photos** live in `assets/pictures/` and are the full original frames, never
cropped — only scaled down for the web, with a small thumbnail beside each for the
folder view. None of the three content pages carry a photo any more; they all live
in My Pictures, reachable from the desktop icon, the Start menu, or the button on
the IRIS page. Double-click a thumbnail to open it in the picture viewer, which
reuses a single window.

**The glovebox is a shared file that anyone can rewrite.** Hit Edit and the whole
thing becomes a textarea: add lines, change lines, delete lines, including ones
somebody else wrote. A save replaces the file with exactly what is in the box —
nothing is merged and nothing is protected. The only rule is that it cannot be
saved completely blank; one character is enough. Ctrl/Cmd-S saves, Esc cancels,
and Tab indents instead of leaving the box.

Under it, each save *inserts* a row rather than updating one. That is a storage
detail with no effect on editing — the newest row is the file — and it exists so
that if someone empties it out of spite you can read an old version back:

```sql
SELECT id, editor, created_at, content FROM glovebox ORDER BY id DESC LIMIT 20;
```

**Editing the writing.** Every window's contents are `<template>` blocks near the
bottom of `index.html` — `tpl-iris`, `tpl-about`, `tpl-rate`, `tpl-pics`,
`tpl-viewer`, `tpl-notes`, `tpl-bin`. The bio and the properties table are plain
HTML in `tpl-about`; the glovebox's starting text is the `<pre>` inside
`tpl-notes`, used until the first save lands in the database. The captions under each photo are the `PICTURES` object in
`js/desktop.js`; the jokes behind Control Panel, Search, Run… and friends are the
`JOKES` object in the same file.

**Adding a window.** Add an entry to `APPS` in `js/desktop.js`, a matching
`<template>`, and a desktop icon or Start-menu entry with `data-open="yourid"`.
Anything anywhere with `data-open` opens that window.

**On a phone** windows open maximised and dragging is off; the taskbar, Start menu
and picture viewer still work.
