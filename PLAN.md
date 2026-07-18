# M12 Walkman — Implementation Plan

Hand this file to Claude Code as-is. It describes a working system end to end:
a Termux background job that mirrors one or more public YouTube playlists to
local audio files every night — each playlist into its own folder — plus a
local web app with a **retro cassette-Walkman** GUI (reference photo:
cream/white TPS-L2-style body, black top cap, navy wordmark, rainbow-stripe
cassette label) installed as a full-screen PWA on the phone.

Treat this as a spec, not a suggestion — where it's ambiguous, make a
reasonable call and note the assumption in a `NOTES.md` you keep updated as
you build.

---

## 0. Already done on the M12 (don't repeat these)

- Termux installed (F-Droid build), fully updated.
- OpenSSH set up and working: `sshd` running on port `8022`, reachable over
  Tailscale, password auth (deliberately no SSH keys — Tailscale's own auth +
  WireGuard encryption is the trust boundary here).
- `sshd` enabled as a persistent `termux-services` service (`sv-enable sshd`)
  so it survives Termux restarts.
- Packages installed: `python`, `ffmpeg`, `cronie`, `termux-services`,
  `termux-api`, `git`.
- Python packages installed: `yt-dlp`, `flask`.
- `termux-setup-storage` granted, `~/storage/shared/...` accessible.
- `~/storage/shared/Music/Walkman` folder created.
- GitHub repo created: **https://github.com/yuv1406/m12-walkman** — empty so
  far, this is where the project code below should live. Clone this onto the
  M12 (`git clone https://github.com/yuv1406/m12-walkman ~/walkman`) as the
  first step of actually building the app, then push commits as you go.

Not yet done: crond scheduling, boot persistence, the actual app code, PWA
manifest/service worker, multi-playlist config, and the GUI itself — all
covered below.

## 1. Goal

- Maintain **one or more** public YouTube playlists as local audio
  libraries. Each playlist the user adds gets synced nightly into its own
  folder, independent of the others.
- Let the user add/remove monitored playlists from within the app itself
  (not just by hand-editing a config file), so growing the library doesn't
  require SSH access every time.
- Serve a local web UI styled as a physical cassette Walkman (see reference
  photo — cream body, black cap, navy wordmark, rainbow cassette stripe),
  installed to the phone's home screen as a **PWA** — full-screen, no browser
  chrome, lock-screen/notification playback controls via the Media Session
  API.
- Everything runs unattended on the Galaxy M12 inside Termux — no desktop,
  no cloud backend, no build step required on-device.

## 2. Non-goals

- No user accounts, no multi-device sync, no cloud storage.
- No support for private/unlisted playlists requiring YouTube auth cookies
  (flag as a stretch goal, don't block on it).
- No Capacitor/native Android wrapper for now — PWA + Media Session covers
  the "feels native" requirement (full-screen, home-screen icon, lock-screen
  controls) without a second build toolchain. Revisit only if PWA proves
  genuinely insufficient.
- No React/webpack/node build step — plain HTML/CSS/JS only, since Termux
  has no reason to run a node build pipeline for a single-user local tool.

## 3. Architecture

```
config.json (playlists: [...])
        │
        ▼
┌─────────────────────┐   nightly cron    ┌──────────────────────────────┐
│ sync_playlist.py      │ ─────────────────▶│ Music/Walkman/<playlist-dir>/│
│  loops all playlists  │                   │   *.mp3, *.jpg               │
│  (yt-dlp + ffprobe)   │                   │   .archive.txt                │
└─────────────────────┘                   │   library.json                │
                                            └───────────────┬───────────────┘
                                                             │ reads all playlist dirs
                                                             ▼
                                            ┌──────────────────────────────┐
                                            │ server.py (Flask)             │
                                            │  /api/playlists  (GET/POST)   │
                                            │  /api/library     (aggregate) │
                                            │  /media/<dir>/<file>          │
                                            │  /manifest.json, /sw.js       │
                                            │  / (static UI)                │
                                            └───────────────┬───────────────┘
                                                             │ serves
                                                             ▼
                                            ┌──────────────────────────────┐
                                            │ Phone browser → installed PWA │
                                            │  full-screen, Media Session   │
                                            │  retro cassette Walkman UI    │
                                            └──────────────────────────────┘
```

Cron + `termux-services` + `Termux:Boot` keep `crond` and `server.py` alive
across reboots; `termux-wake-lock` and unrestricted battery settings keep
Termux from being killed overnight.

## 4. Repo layout to produce (in yuv1406/m12-walkman)

```
walkman/
├── PLAN.md
├── NOTES.md                  (assumptions/decisions log — create as you go)
├── README.md                 (setup + usage instructions for the human)
├── requirements.txt           (yt-dlp, flask)
├── sync_playlist.py           (nightly downloader, loops over all playlists)
├── server.py                  (Flask app)
├── config.example.json        (playlists array + tunables; gitignore real config.json)
├── .gitignore                 (config.json, *.archive.txt, downloaded media)
├── static/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/                 (192x192, 512x512 app icons — cassette glyph)
└── .termux-boot/
    └── start-services.sh      (copy target for ~/.termux/boot/)
```

## 5. Backend spec

### 5.1 `config.json` (gitignore this; ship `config.example.json`)

```json
{
  "playlists": [
    {
      "id": "main",
      "name": "Main Mix",
      "url": "https://www.youtube.com/playlist?list=REPLACE_ME",
      "dir": "Main"
    }
  ],
  "music_root": "~/storage/shared/Music/Walkman",
  "audio_format": "mp3",
  "audio_quality": "192",
  "server_port": 8080
}
```

- `id` — short slug, stable identifier, used in URLs/API, never shown to the
  user.
- `name` — human label shown in the UI (e.g. on the nameplate / playlist
  picker).
- `dir` — folder name under `music_root`; each playlist's files, archive
  file, and `library.json` live in `music_root/<dir>/`, fully isolated from
  other playlists.
- Adding a playlist through the UI (see §5.3) appends to this array and
  creates `music_root/<dir>/` — `sync_playlist.py` re-reads `config.json`
  fresh on every run, so a playlist added today syncs starting tonight with
  no extra step.

### 5.2 `sync_playlist.py`

- Load `config.json`, loop over every entry in `playlists`.
- For each playlist:
  - Ensure `music_root/<dir>/` exists.
  - Run `yt-dlp` against that playlist's `url`, with a **per-playlist**
    archive file at `music_root/<dir>/.archive.txt` (critical — a shared
    archive file across playlists would cause a video appearing in two
    playlists to only download once, into the wrong folder).
  - Flags: `--extract-audio --audio-format mp3 --embed-thumbnail
    --embed-metadata --download-archive <that dir's .archive.txt>
    --no-overwrites --ignore-errors --write-thumbnail --convert-thumbnails
    jpg`.
  - Output filename template: `%(title)s [%(id)s].%(ext)s`.
  - Rebuild that playlist's `library.json` by scanning its folder (don't
    just append — more robust to manual edits/interrupted runs). Use
    `ffprobe` for duration.
- One playlist failing (bad URL, network blip) must not stop the others —
  wrap each playlist's sync in its own try/except and log which one failed.
- Per-playlist `library.json` shape:

  ```json
  {
    "playlist_id": "main",
    "playlist_name": "Main Mix",
    "generated_at": "2026-07-18T02:30:00",
    "tracks": [
      {
        "id": "dQw4w9WgXcQ",
        "title": "Song Title",
        "artist": "Uploader or channel name",
        "file": "Song Title [dQw4w9WgXcQ].mp3",
        "thumbnail": "Song Title [dQw4w9WgXcQ].jpg",
        "duration": 212.4,
        "added_at": "2026-07-18T02:30:00"
      }
    ]
  }
  ```
- Log to stdout (cron redirects this to a file — see §7).
- Exit non-zero only on total failure (e.g. `yt-dlp` missing entirely, or
  `config.json` unreadable); individual video or playlist failures should be
  skipped, not fatal.

### 5.3 `server.py`

- Flask, single file is fine.
- Routes:
  - `GET /` → `static/index.html`
  - `GET /style.css`, `GET /app.js`, `GET /manifest.json`, `GET /sw.js` →
    static files (correct `Content-Type`, especially `application/manifest+json`
    for the manifest)
  - `GET /api/playlists` → the `playlists` array from `config.json` (without
    ever needing to expose the raw file path)
  - `POST /api/playlists` → body `{ "name": "...", "url": "..." }` — server
    generates a slug `id`/`dir` from `name`, appends to `config.json`,
    creates `music_root/<dir>/`, returns the new playlist entry. This is
    what backs the "add a playlist to monitor" UI flow — no sync is
    triggered immediately, it just registers for the next nightly run
    (mention this in the UI copy so the user isn't confused why nothing
    downloads instantly).
  - `DELETE /api/playlists/<id>` → removes from `config.json`. **Do not**
    delete the already-downloaded folder automatically — leave the files,
    just stop syncing that playlist. Note this behavior in the UI.
  - `GET /api/library` → aggregates every playlist's `library.json` into one
    response, each track tagged with `playlist_id`/`playlist_name`, e.g.
    `{ "playlists": [...], "tracks": [...all tracks, each with playlist_id...] }`
  - `GET /media/<dir>/<path:filename>` → stream a file from
    `music_root/<dir>/`. **Must** resolve the path and reject anything
    escaping `music_root` (path traversal guard) — validate `dir` against
    the known playlist dirs from `config.json`, don't trust it blindly.
- Bind to `127.0.0.1` only — local-only server, not exposed to the network.
- No database, no auth — single user, local device, and it's not reachable
  outside the phone anyway.

## 6. PWA — installable, full-screen, lock-screen controls

Goal: after visiting the site once and using Chrome's "Add to Home Screen,"
the app opens with zero browser chrome and behaves like a native player,
including lock-screen/notification playback controls.

### 6.1 `static/manifest.json`

- `name`/`short_name`: "Walkman"
- `display`: `"standalone"` (or `"fullscreen"` if you want to also hide the
  status bar — test both, standalone usually looks better since you still
  get the clock/battery indicator)
- `background_color` / `theme_color`: match the chassis cream (`#f2ede0` or
  whatever §7's token system settles on) so the splash screen and status bar
  aren't a jarring mismatch
- `icons`: 192x192 and 512x512 PNGs — a simple cassette-tape glyph on the
  cream/black chassis colors, put these in `static/icons/`
- `start_url`: `/`

### 6.2 `static/sw.js` (service worker)

- Minimal cache-first strategy for the app shell (`/`, `/style.css`,
  `/app.js`, `/manifest.json`) so the UI paints instantly on reopen even
  before the local server responds.
- **Do not cache** `/api/library`, `/api/playlists`, or `/media/*` — those
  must always hit the live server, since the whole point is fresh data.
- Register it from `app.js` with a standard
  `navigator.serviceWorker.register('/sw.js')`, guarded by a feature check.

### 6.3 Media Session API (in `app.js`)

- On play, set `navigator.mediaSession.metadata = new MediaMetadata({...})`
  with the current track's title, artist, and artwork (playlist name can
  double as "album").
- Wire `navigator.mediaSession.setActionHandler` for `play`, `pause`,
  `seekbackward`, `seekforward` (map these to your REW/F.FWD scrub logic
  from §7) — this is what makes play/pause/seek show up on the Android lock
  screen and notification shade even though it's "just" a web app.

## 7. Frontend spec — retro cassette Walkman GUI

Reference: the attached photo of a cream/white cassette Walkman — black top
cap holding the transport buttons, a cassette door showing the reels through
a smoked window with a bold diagonal **rainbow stripe** across the tape
label, "STEREO WALKMAN" in a navy serif-ish wordmark on the body, and a small
vertical nameplate on the side (personalization — repurpose this as the
**active playlist name**, shown vertically, exactly where a name like
"ELLIE" sits in the photo). This is the visual target — not the steel-blue/
orange palette from an earlier draft of this plan, and not an iPod click
wheel.

### 7.1 Design tokens

**Color**
- `--body-cream: #f2ede0` (main chassis)
- `--body-cream-shadow: #d9d2bf` (chassis shading/bezel)
- `--cap-black: #1c1b19` (top cap housing the buttons)
- `--wordmark-navy: #22285c` ("STEREO WALKMAN" text, nameplate text)
- `--cassette-well: #16161a` (smoked window behind the reels)
- `--tape-amber: #b98a4f` (visible tape between reels)
- Rainbow stripe (the signature accent, used once, on the cassette label —
  not scattered elsewhere as decoration): a 5–6 color diagonal gradient band,
  e.g. `#e94b3c → #f2994a → #f2c94c → #6fcf97 → #56ccf2 → #5b6ee1`.
- `--lcd-bg: #12140f`, `--lcd-amber: #ffb238` (track display / counter glow)

**Type**
- Wordmark/branding: a rounded-but-confident sans or slab (e.g. `Fredoka` or
  `Baloo 2` from Google Fonts) in navy, echoing the friendly hand-lettered
  feel of "STEREO WALKMAN" in the reference photo — not a cold industrial
  condensed face.
- Button labels: same family, all caps, on the black cap.
- Counter/track-display: a genuine LCD-style monospace (`Share Tech Mono` or
  `VT323`) for the tape counter and now-playing marquee — the one place
  pixel/segment styling is earned.

**Layout & signature element**
- Rectangular cream body, black cap across the top third housing the
  transport buttons (REW, PLAY, F.FWD, STOP, PAUSE) as raised black-on-black
  buttons with subtle bevels — matches the reference photo's black cap
  silhouette.
- Cassette door below the cap: smoked window with two circular reels that
  visibly rotate during playback (speed tied to real playback, tape arcing
  between them shortens/lengthens as the track progresses), and the rainbow
  stripe rendered as the "label" across the bottom of the window — this
  stripe is the one bold color moment, keep the rest of the palette quiet
  around it.
- "STEREO WALKMAN" wordmark on the body to the left of the door, in navy,
  echoing the reference photo's placement and slight tilt.
- Vertical nameplate on the right edge of the device (where "ELLIE" sits in
  the photo) — this now displays the **active playlist's name**, rotated
  90°, navy text on the cream body. Tapping it opens the playlist
  picker/manager (§7.3).
- Thin LCD strip for now-playing title/artist (marquee if it overflows) and
  a 4-digit rolling tape counter, positioned between the cassette door and
  the button cap or just below the door — pick whichever reads cleanest once
  you have the door and cap laid out.
- A vertical volume slider styled into the body edge, matching the cream
  chassis rather than looking bolted-on.
- Respect `prefers-reduced-motion`: static reel graphic + crossfades instead
  of any 3D flip/rotation transitions.

### 7.2 Screens/states

1. **Player face** (default): cap with transport buttons, cassette door with
   animated reels, rainbow-stripe label, LCD track display + tape counter,
   nameplate showing active playlist, volume slider.
2. **Library face**: reachable by tapping the cassette door (or a dedicated
   small "EJECT" affordance) — flips to a scrollable track list for the
   *currently selected playlist*. Selecting a track loads it and flips back
   to the player face.
3. **Playlist picker/manager** (new, reachable by tapping the nameplate):
   - Lists all monitored playlists (from `/api/playlists`) — tapping one
     makes it "active" (its tracks populate the library face, its name shows
     on the nameplate).
   - An "Add Playlist" form: name field + YouTube playlist URL field, submit
     → `POST /api/playlists`. After adding, show a clear note like "Added —
     will sync in tonight's run" rather than implying anything downloads
     immediately.
   - Each playlist row has a way to remove it (`DELETE /api/playlists/<id>`)
     with a confirmation, and copy clarifying that existing downloaded files
     are kept, only future syncing stops.
4. **Empty state**: if there are zero playlists at all, LCD shows something
   like `NO TAPE — ADD A PLAYLIST` and nudges toward the nameplate/picker.
   If a playlist exists but has zero tracks yet, LCD shows
   `LIBRARY EMPTY — SYNCS TONIGHT`.

### 7.3 Interaction requirements

- All controls touch-friendly, no hover-only affordances — this is a phone
  browser.
- PLAY/PAUSE state visually obvious (reels stop, LCD counter freezes).
- REW/F.FWD scrub the current track (±10s per tap, or continuous on
  press-and-hold), wired to the same handlers as the Media Session
  `seekbackward`/`seekforward` actions from §6.3. STOP resets to 0:00 and
  pauses.
- Switching playlists via the picker should not require a page reload —
  update state in `app.js` and re-render.
- No React/build tooling — vanilla HTML/CSS/JS only, Google Fonts via
  standard `<link>`.

### 7.4 Explicit anti-goals for this UI

- Don't reuse the iPod click-wheel or the earlier steel-blue/single-orange
  palette from prior drafts of this plan — this photo is the design target
  now.
- Don't scatter the rainbow stripe as a decorative motif elsewhere in the
  UI (buttons, backgrounds, etc.) — it appears once, on the cassette label,
  exactly like the reference photo. Everywhere else stays cream/black/navy.
- Don't add decorative elements (VU meters, equalizer bars) unless driven by
  real audio data.

## 8. Termux integration tasks

- [x] Packages installed, storage permission granted, `Music/Walkman`
      folder created (see §0).
- [ ] `git clone https://github.com/yuv1406/m12-walkman ~/walkman`, build
      the project inside it, commit and push as you go.
- [ ] `sv-enable crond`, then a crontab entry running `sync_playlist.py`
      nightly (default: 2:30 AM), redirecting stdout/stderr to
      `~/walkman/sync.log`.
- [ ] `~/.termux/boot/start-services.sh` (ship the template in
      `.termux-boot/start-services.sh`) that runs `termux-wake-lock`,
      `sv-enable crond`, `sv-enable sshd`, and launches `server.py` with
      `nohup ... &` on device boot — Termux:Boot app required (separate
      F-Droid install, document in README, don't assume Claude Code can
      install it).
- [ ] Document setting Termux's (and, given the Samsung-specific issue
      already hit with Tailscale) any relevant background-app's battery mode
      to "Unrestricted," and removing it from Samsung's sleeping-apps lists —
      this can't be scripted, call it out clearly in README.

## 9. Milestones / build order

1. Clone the repo onto the M12, scaffold repo layout, `config.example.json`,
   `requirements.txt`, `.gitignore`.
2. `sync_playlist.py` — test against 1–2 real small public playlists,
   confirm per-playlist folders, archive files, and `library.json` all
   behave correctly and independently.
3. `server.py` — playlist CRUD endpoints, aggregated `/api/library`, the
   path-traversal guard on `/media/<dir>/<file>`; smoke-test with curl.
4. Build `static/index.html` + `style.css` static (non-interactive) first —
   get the cream chassis, black cap, cassette window/reels, rainbow stripe,
   nameplate, and LCD strip looking right against the reference photo before
   wiring up JS. Check against §7.4's anti-goals.
5. Wire `app.js`: fetch playlists + aggregated library, audio playback,
   reel rotation synced to `timeupdate`, tape counter, library-face and
   playlist-picker interactions, transport controls, add/remove playlist
   flow.
6. Add `manifest.json`, `sw.js`, icons, Media Session wiring (§6). Test
   "Add to Home Screen" on the actual M12, confirm full-screen + lock-screen
   controls.
7. Cross-check touch interactions on a real narrow viewport (~360–400px).
8. Write the human-facing `README.md`: package install, cron setup, boot
   script install, PWA install instructions.
9. Update `NOTES.md` with anything changed from this plan and why.

## 10. Acceptance criteria

- `python sync_playlist.py` against 2+ configured playlists produces
  correctly separated folders, archive files, and `library.json`s — a video
  in one playlist never lands in another playlist's folder.
- `/api/playlists` supports listing, adding, and removing playlists; adding
  one creates its folder immediately without requiring a manual sync.
- `/api/library` returns every track from every playlist, each correctly
  tagged with its playlist.
- Opening the installed PWA shows the cream/black cassette-Walkman UI
  matching the reference photo's palette and layout, not a generic player.
- Reels visibly spin during playback, stop when paused; tape counter moves
  during playback; nameplate shows the active playlist name.
- Library face and playlist picker are both reachable and functional;
  switching playlists updates the library face without a page reload.
- REW/F.FWD scrub within the current track; STOP resets and pauses; the same
  actions work from the Android lock screen via Media Session.
- Installed as a home-screen PWA, the app opens full-screen with no browser
  chrome.
- No console errors on load or during normal use; `prefers-reduced-motion`
  respected; `/media/<dir>/<file>` rejects path traversal attempts.
- README is sufficient for a non-developer to get this running on a fresh
  Termux install, including manual steps that can't be scripted.

## 11. Config the human still needs to supply

- At least one real playlist URL + name, added either by hand-editing
  `config.json` before first sync or through the in-app "Add Playlist" flow
  once the UI exists.
- Confirm desired nightly sync time (default proposed: 2:30 AM).
- App icon artwork for `static/icons/` (a simple cassette glyph is fine to
  start; can be refined later).
