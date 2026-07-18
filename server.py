#!/usr/bin/env python3
import json, os, re
from pathlib import Path
from flask import Flask, jsonify, request, send_file, send_from_directory

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "config.json"
STATIC_DIR = SCRIPT_DIR / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")

def load_config():
    return json.loads(CONFIG_PATH.read_text())

def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")

def get_music_root():
    return Path(os.path.expanduser(load_config()["music_root"]))

def known_dirs(cfg):
    return {p["dir"] for p in cfg.get("playlists", [])}

@app.route("/api/playlists", methods=["GET", "POST"])
def playlists():
    cfg = load_config()
    if request.method == "GET":
        return jsonify(cfg.get("playlists", []))
    body = request.get_json(force=True)
    name = body.get("name", "").strip()
    url = body.get("url", "").strip()
    if not name or not url:
        return jsonify({"error": "name and url required"}), 400
    # ponytail: naive slug, no unicode normalization needed for single-user
    pid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "playlist"
    pdir = pid
    entry = {"id": pid, "name": name, "url": url, "dir": pdir}
    cfg.setdefault("playlists", []).append(entry)
    save_config(cfg)
    root = get_music_root()
    (root / pdir).mkdir(parents=True, exist_ok=True)
    return jsonify(entry), 201

@app.route("/api/playlists/<pid>", methods=["DELETE"])
def delete_playlist(pid):
    cfg = load_config()
    pl = cfg.get("playlists", [])
    cfg["playlists"] = [p for p in pl if p["id"] != pid]
    if len(pl) == len(cfg["playlists"]):
        return jsonify({"error": "not found"}), 404
    save_config(cfg)
    return jsonify({"ok": True})

@app.route("/api/library")
def library():
    cfg = load_config()
    root = get_music_root()
    playlists = cfg.get("playlists", [])
    all_tracks = []
    for p in playlists:
        lib_path = root / p["dir"] / "library.json"
        if lib_path.exists():
            lib = json.loads(lib_path.read_text())
            for t in lib.get("tracks", []):
                t["playlist_id"] = p["id"]
                t["playlist_name"] = p["name"]
                t["playlist_dir"] = p["dir"]
                all_tracks.append(t)
    return jsonify({"playlists": playlists, "tracks": all_tracks})

@app.route("/media/<dir>/<path:filename>")
def media(dir, filename):
    cfg = load_config()
    if dir not in known_dirs(cfg):
        return "invalid dir", 404
    root = get_music_root()
    full = (root / dir / filename).resolve()
    if not str(full).startswith(str(root.resolve())):
        return "path traversal blocked", 403
    return send_file(str(full))

@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")

if __name__ == "__main__":
    cfg = load_config()
    port = cfg.get("server_port", 8080)
    app.run(host="127.0.0.1", port=port, debug=False)
