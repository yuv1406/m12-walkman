#!/usr/bin/env python3
import json, os, subprocess, sys, time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"

def load_config():
    return json.loads(CONFIG_PATH.read_text())

def sync_playlist(cfg, pl):
    root = Path(os.path.expanduser(cfg["music_root"]))
    dest = root / pl["dir"]
    dest.mkdir(parents=True, exist_ok=True)

    archive = dest / ".archive.txt"
    fmt = cfg.get("audio_format", "mp3")
    quality = cfg.get("audio_quality", "192")
    tmpl = str(dest / "%(title)s [%(id)s].%(ext)s")

    cmd = [
        "yt-dlp", "--print-json",
        "--extract-audio", f"--audio-format={fmt}",
        f"--audio-quality={quality}",
        "--embed-thumbnail", "--embed-metadata",
        "--download-archive", str(archive),
        "--no-overwrites", "--ignore-errors",
        "--write-thumbnail", "--convert-thumbnails", "jpg",
        "-o", tmpl, pl["url"]
    ]

    r = subprocess.run(cmd, stdout=subprocess.PIPE, text=True)
    now = time.strftime("%Y-%m-%dT%H:%M:%S")

    tracks = []
    for line in r.stdout.strip().splitlines():
        if not line.strip():
            continue
        info = json.loads(line)
        audio_file = f"{info['title']} [{info['id']}].{fmt}"
        thumb_file = f"{info['title']} [{info['id']}].jpg"
        if not (dest / audio_file).exists():
            print(f"  WARN: {audio_file} missing, skipping")
            continue
        tracks.append({
            "id": info["id"],
            "title": info.get("title", "Unknown"),
            "artist": info.get("uploader", "Unknown"),
            "file": audio_file,
            "thumbnail": thumb_file,
            "duration": info.get("duration", 0),
            "added_at": now,
        })

    library = {
        "playlist_id": pl["id"],
        "playlist_name": pl["name"],
        "generated_at": now,
        "tracks": tracks,
    }
    (dest / "library.json").write_text(json.dumps(library, indent=2))
    print(f"  Downloaded {len(tracks)} tracks")

def main():
    try:
        cfg = load_config()
    except Exception as e:
        print(f"FATAL: config load failed: {e}", file=sys.stderr)
        sys.exit(1)

    nok = 0
    for pl in cfg.get("playlists", []):
        try:
            print(f"Syncing: {pl.get('name', pl['id'])}")
            sync_playlist(cfg, pl)
            print(f"  OK: {pl['id']}")
        except Exception as e:
            print(f"  FAIL: {pl['id']}: {e}", file=sys.stderr)
            nok += 1

    if nok:
        sys.exit(1)

if __name__ == "__main__":
    main()
