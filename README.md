# Walkman Sync

YouTube playlist downloader that keeps a local music folder updated. Downloads to a single flat directory, skips duplicates via shared archive.

## Setup

1. **Clone & install deps**:
   ```
   git clone https://github.com/yuv1406/m12-walkman ~/walkman
   cd ~/walkman
   pip install -r requirements.txt
   ```

2. **Configure**: copy `config.example.json` to `config.json` and add playlists.
   Each playlist downloads to `~/storage/shared/Music/Walkman/` (no subdirectories).
   If a video appears in multiple playlists, it downloads once (same filename, `--no-overwrites`).

3. **Run a sync**:
   ```
   python sync_playlist.py
   ```

4. **Browse with your player**: use ClassiPod or any local player that reads `~/storage/shared/Music/Walkman/`.

## Nightly sync (cron)

```
crontab -e
```
Add:
```
30 2 * * * cd ~/walkman && python sync_playlist.py >> sync.log 2>&1
```

## Nightly boot (optional)

Keep Termux alive overnight:

```
echo "termux-wake-lock" > ~/.termux/boot/start.sh
echo "sv-enable crond" >> ~/.termux/boot/start.sh
chmod +x ~/.termux/boot/start.sh
```

Install [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) from F-Droid and set it to launch at boot.

## Layout

```
walkman/
├── sync_playlist.py   # Downloads all playlists to Music/Walkman/
├── config.json        # Your playlists (gitignored)
└── requirements.txt   # yt-dlp
```
