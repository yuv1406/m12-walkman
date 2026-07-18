const audio = document.getElementById('audio');
const reelL = document.getElementById('reelL');
const reelR = document.getElementById('reelR');
const lcdTrack = document.getElementById('lcdTrack');
const lcdCounter = document.getElementById('lcdCounter');
const nameplateText = document.getElementById('nameplateText');
const trackList = document.getElementById('trackList');
const playlistList = document.getElementById('playlistList');
const libraryFace = document.getElementById('libraryFace');
const picker = document.getElementById('picker');
const libraryTitle = document.getElementById('libraryTitle');
const walkman = document.getElementById('app');
let playlists = [];
let tracks = [];
let currentPlaylistId = null;
let currentIndex = -1;

function fmtTime(s) {
  if (!s || isNaN(s)) return '00:00';
  s = Math.floor(s);
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

function loadTrack(idx) {
  const t = tracks[idx];
  if (!t) return;
  currentIndex = idx;
  audio.src = `/media/${t.playlist_dir || t.playlist_id}/${encodeURIComponent(t.file)}`;
  audio.load();
  audio.play();
  setPlaying(true);
  updateLCD(t);
  updateMediaSession(t);
}

function setPlaying(v) {
  walkman.classList.toggle('playing', v);
  reelL.classList.toggle('spinning', v);
  reelR.classList.toggle('spinning', v);
  reelL.classList.toggle('paused', !v);
  reelR.classList.toggle('paused', !v);
}

function updateLCD(t) {
  lcdTrack.textContent = t ? `${t.title} — ${t.artist}` : 'NO TAPE';
  lcdCounter.textContent = fmtTime(audio.currentTime);
}

function updateMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.playlist_name || '',
    artwork: [{ src: `/media/${t.playlist_dir || t.playlist_id}/${encodeURIComponent(t.thumbnail)}`, sizes: '512x512', type: 'image/jpeg' }]
  });
}

function renderLibrary() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  libraryTitle.textContent = pl ? pl.name : 'Library';
  trackList.innerHTML = tracks.map((t, i) => `
    <div class="track-item" data-index="${i}">
      <span class="track-num">${i + 1}</span>
      <div class="track-info">
        <div class="track-title">${escHtml(t.title)}</div>
        <div class="track-artist">${escHtml(t.artist)}</div>
      </div>
      <span class="track-duration">${fmtTime(t.duration)}</span>
    </div>
  `).join('');
}

function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

function renderPlaylists() {
  playlistList.innerHTML = playlists.map(p => `
    <div class="playlist-item${p.id === currentPlaylistId ? ' active' : ''}" data-id="${p.id}">
      <span class="playlist-name">${escHtml(p.name)}</span>
      <button class="playlist-remove" data-remove="${p.id}">Remove</button>
    </div>
  `).join('');
}

async function fetchPlaylists() {
  const r = await fetch('/api/playlists');
  playlists = await r.json();
  if (playlists.length && !currentPlaylistId) currentPlaylistId = playlists[0].id;
  setActivePlaylist();
  renderPlaylists();
}

async function fetchLibrary() {
  const r = await fetch('/api/library');
  const data = await r.json();
  tracks = data.tracks || [];
  if (tracks.length > 0 && currentIndex === -1) { currentIndex = 0; loadTrack(currentIndex); }
  renderLibrary();
}

function setActivePlaylist() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  nameplateText.textContent = pl ? pl.name : playlists.length ? 'SELECT' : 'NO TAPE';
  if (pl) {
    tracks = []; currentIndex = -1;
    renderLibrary();
    fetchLibrary();
  }
}

// Transport
document.querySelector('.transport').addEventListener('click', e => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'play') { if (tracks[currentIndex]) { audio.play(); setPlaying(true); } }
  else if (action === 'pause') { audio.pause(); setPlaying(false); }
  else if (action === 'stop') { audio.pause(); audio.currentTime = 0; setPlaying(false); updateLCD(tracks[currentIndex]); }
  else if (action === 'rewind') { audio.currentTime = Math.max(0, audio.currentTime - 10); }
  else if (action === 'forward') { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10); }
});

// Cassette door → library
document.getElementById('cassetteDoor').addEventListener('click', () => {
  if (playlists.length && tracks.length) { libraryFace.classList.toggle('open'); renderLibrary(); }
});

// Nameplate → picker
document.getElementById('nameplate').addEventListener('click', () => { picker.classList.toggle('open'); renderPlaylists(); });

// Overlay close buttons
document.querySelectorAll('.close-btn').forEach(b => {
  b.addEventListener('click', () => {
    libraryFace.classList.remove('open');
    picker.classList.remove('open');
  });
});

// Track select
trackList.addEventListener('click', e => {
  const item = e.target.closest('.track-item');
  if (item) {
    const idx = parseInt(item.dataset.index);
    loadTrack(idx);
    libraryFace.classList.remove('open');
  }
});

// Playlist select / remove
playlistList.addEventListener('click', async e => {
  const item = e.target.closest('.playlist-item');
  const remove = e.target.closest('.playlist-remove');
  if (remove) {
    e.stopPropagation();
    const id = remove.dataset.remove;
    if (!confirm(`Stop syncing "${playlists.find(p => p.id === id)?.name}"? (Files kept.)`)) return;
    await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
    if (currentPlaylistId === id) currentPlaylistId = null;
    await fetchPlaylists();
    if (!currentPlaylistId && playlists.length) { currentPlaylistId = playlists[0].id; setActivePlaylist(); }
    return;
  }
  if (item) {
    currentPlaylistId = item.dataset.id;
    picker.classList.remove('open');
    setActivePlaylist();
  }
});

// Add playlist
document.getElementById('addPlaylistForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('playlistName').value.trim();
  const url = document.getElementById('playlistUrl').value.trim();
  if (!name || !url) return;
  await fetch('/api/playlists', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, url}) });
  document.getElementById('playlistName').value = '';
  document.getElementById('playlistUrl').value = '';
  await fetchPlaylists();
  if (playlists.length === 1) { currentPlaylistId = playlists[0].id; setActivePlaylist(); }
});

// Audio events
audio.addEventListener('timeupdate', () => { updateLCD(tracks[currentIndex]); });
audio.addEventListener('ended', () => {
  if (currentIndex < tracks.length - 1) { loadTrack(currentIndex + 1); }
  else { setPlaying(false); updateLCD(tracks[currentIndex]); }
});

// Media Session
if ('mediaSession' in navigator) {
  const seek = (d) => { audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + d)); };
  navigator.mediaSession.setActionHandler('play', () => { audio.play(); setPlaying(true); });
  navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); setPlaying(false); });
  navigator.mediaSession.setActionHandler('seekbackward', () => seek(-10));
  navigator.mediaSession.setActionHandler('seekforward', () => seek(10));
  navigator.mediaSession.setActionHandler('previoustrack', () => { if (currentIndex > 0) loadTrack(currentIndex - 1); });
  navigator.mediaSession.setActionHandler('nexttrack', () => { if (currentIndex < tracks.length - 1) loadTrack(currentIndex + 1); });
}

// Service worker
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

// Init
fetchPlaylists();
