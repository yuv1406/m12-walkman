# M12 Walkman

Retro cassette Walkman PWA that syncs YouTube playlists to local audio files on an Android phone running Termux.

## Setup

1. **Clone & install deps**:
   ```
   git clone https://github.com/yuv1406/m12-walkman ~/walkman
   cd ~/walkman
   pip install -r requirements.txt
   ```

2. **Configure**: copy `config.example.json` to `config.json` and add at least one playlist URL.

3. **Run a sync**:
   ```
   python sync_playlist.py
   ```

4. **Start the server**:
   ```
   python server.py
   ```
   Visit `http://localhost:8080` in the phone browser. Add to home screen for PWA.

## PWA install

- Open `http://localhost:8080` in Chrome
- Tap ⋮ → "Add to Home Screen"
- App opens full-screen with lock-screen playback controls

## Nightly sync (cron)

```
crontab -e
```
Add:
```
30 2 * * * cd ~/walkman && python sync_playlist.py >> sync.log 2>&1
```

## Boot persistence

Install [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) from F-Droid, then:

```
cp .termux-boot/start-services.sh ~/.termux/boot/
chmod +x ~/.termux/boot/start-services.sh
```

## Battery

Set Termux and Tailscale battery to **Unrestricted** and exclude them from Samsung's sleeping apps list (Settings → Device Care → Battery → Background usage limits).

## Layout

```
walkman/
├── sync_playlist.py   # Nightly downloader
├── server.py          # Flask API server
├── config.json        # Your playlists (gitignored)
├── static/            # Web UI
│   ├── index.html, style.css, app.js
│   ├── manifest.json, sw.js
│   └── icons/
└── .termux-boot/      # Boot script template
```
