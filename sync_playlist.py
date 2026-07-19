#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"

def load_config():
    return json.loads(CONFIG_PATH.read_text())

def sync_playlist(cfg, pl):
    root = Path(os.path.expanduser(cfg["music_root"]))
    root.mkdir(parents=True, exist_ok=True)

    archive = root / ".archive.txt"
    fmt = cfg.get("audio_format", "mp3")
    quality = cfg.get("audio_quality", "192")
    tmpl = str(root / "%(title)s [%(id)s].%(ext)s")

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

    json_tmp = root / ".sync_tmp.json"
    with open(json_tmp, "w") as f:
        subprocess.run(cmd, stdout=f, text=True)
    raw = json_tmp.read_text()
    json_tmp.unlink(missing_ok=True)

    tracks = []
    for line in raw.strip().splitlines():
        if not line.strip():
            continue
        info = json.loads(line)
        audio_file = f"{info['title']} [{info['id']}].{fmt}"
        thumb_file = f"{info['title']} [{info['id']}].jpg"
        if not (root / audio_file).exists():
            print(f"  WARN: {audio_file} missing, skipping")
            continue
        tracks.append({
            "id": info["id"],
            "title": info.get("title", "Unknown"),
            "artist": info.get("uploader", "Unknown"),
            "file": audio_file,
            "thumbnail": thumb_file,
            "duration": info.get("duration", 0),
            "added_at": sys.platform,
        })

    print(f"  Downloaded {len(tracks)} tracks", flush=True)

def main():
    try:
        cfg = load_config()
    except Exception as e:
        print(f"FATAL: config load failed: {e}", file=sys.stderr)
        sys.exit(1)

    nok = 0
    for pl in cfg.get("playlists", []):
        try:
            print(f"Syncing: {pl.get('name', pl['id'])}", flush=True)
            sync_playlist(cfg, pl)
            print(f"  OK: {pl['id']}")
        except Exception as e:
            print(f"  FAIL: {pl['id']}: {e}", file=sys.stderr)
            nok += 1

    if nok:
        sys.exit(1)

if __name__ == "__main__":
    main()
