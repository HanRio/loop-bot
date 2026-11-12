// localhost 시험용 가짜 API. app.js가 localhost일 때만 불러온다.
// ?fail=too_big · ?fail=expired · ?fail=save · ?fail=note · ?fail=users 로 오류 장면을 만든다.
// ?role=member 면 관리자가 공유한 목록이 있는 멤버로 시작한다. ?role=subadmin 면 관리자가 지정한 관리자로 시작한다.
import { ApiError } from './api.js';
import { cleanUsername } from './users-logic.js';

const params = new URLSearchParams(location.search);
const FAIL = params.get('fail');
const SLOW = Number(params.get('slow')) || 0;
const MEMBER = params.get('role') === 'member';
const SUBADMIN = params.get('role') === 'subadmin';
const IS_OWNER = !MEMBER && !SUBADMIN;
const TOO_BIG_ID = 2;
const AUDIO_URL = './fake-audio.mp3';
const SHEET_URL = './fake-sheet.svg';
const SHARED_PLAYLIST_ID = 101;
const SHARED_VIDEO_ID = 'dQw4w9WgXcQ';
const SHEET_MAX_PAGES = 20;
const VIDEO_ID_RE = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;

const FAKE_LRC = ['주님은 나의 목자', '내게 부족함 없네', '푸른 풀밭 위에', '나를 눕히시고', '', '쉴 만한 물가로', '인도하시는 주', '내 영혼 소생케 하시네', '그 이름 위하여', '의의 길로 가리라']
  .map((text, i) => `[${String(Math.floor((i * 4) / 60)).padStart(2, '0')}:${String((i * 4) % 60).padStart(2, '0')}.00]${text}`)
  .join('\n');
const FAKE_CANDIDATES = [
  { id: 9001, track: '주님은 나의 목자', artist: '시험 가수', duration: 41 },
  { id: 9002, track: '주님은 나의 목자 (Live)', artist: '다른 가수', duration: 45 },
];
const LYRICS_OFFSET_LIMIT = 30000;

export function createApi() {
  let lyricsState = { 1: { status: 'found', synced: FAKE_LRC, offset_ms: 0 }, 2: { status: 'none' } };
  let library = MEMBER ? [] : [1, 2, 3, 4, 5].map((id) => ({ id, title: id === 4 ? '[LIVE] 예수, 늘 함께하시네 - 마커스워십 정규 앨범 실황 (Official Live Video) 긴 제목 확인용' : `시험 곡 ${id}`, duration: 60 + id }));
  let playlists = MEMBER
    ? [{ id: 1, name: '기본', track_ids: [], shared: false }]
    : [
        { id: 1, name: '기본', track_ids: [1, 2, 3], shared: true },
        { id: 2, name: '밤', track_ids: [4, 5], shared: false },
      ];
  // 관리자가 공유한 목록(멤버에게만 보인다). 곡 2개, 하나는 사진과 영상이 있다.
  const sharedPlaylists = MEMBER ? [{ id: SHARED_PLAYLIST_ID, name: '공유 목록', track_ids: [201, 202] }] : [];
  const sharedTracks = MEMBER
    ? [
        { id: 201, title: '공유 곡 1', duration: 90 },
        { id: 202, title: '공유 곡 2', duration: 80 },
      ]
    : [];
  // 사진 쪽은 3장으로 시작한다. 버전은 한 번 쓴 값을 다시 쓰지 않도록 위로만 올린다.
  let media = MEMBER
    ? { 201: { sheet_version: 3, sheet_count: 3, video_id: SHARED_VIDEO_ID } }
    : { 1: { sheet_version: 3, sheet_count: 3, video_id: null } };
  let versionCounter = 3;
  let notes = {};
  let activeId = 1;
  let failedSaves = 0;
  let failedNotes = 0;
  // 지운 id를 다시 쓰지 않도록 올라가기만 한다.
  let lastId = 2;
  let usernames = [
    { username: 'sample_one', seen: true, is_admin: false, is_owner: false },
    { username: 'sample_two', seen: false, is_admin: false, is_owner: false },
    { username: 'sample_three', seen: true, is_admin: true, is_owner: false },
  ];

  const copy = (value) => structuredClone(value);
  const nextId = () => {
    lastId += 1;
    return lastId;
  };
  const find = (id) => {
    const playlist = playlists.find((p) => p.id === id);
    if (!playlist) throw new ApiError('not_found', 404);
    return playlist;
  };
  const findTrack = (id) => {
    const track = library.find((t) => t.id === id);
    if (!track) throw new ApiError('not_found', 404);
    return track;
  };
  const nextVersion = () => {
    versionCounter += 1;
    return versionCounter;
  };
  const adminOnly = () => {
    if (MEMBER) throw new ApiError('forbidden', 403);
  };

  return {
    async state() {
      return copy({
        library,
        playlists,
        active_id: activeId,
        shared_playlists: sharedPlaylists,
        shared_tracks: sharedTracks,
        media,
        notes,
        is_admin: !MEMBER,
        is_owner: IS_OWNER,
      });
    },
    async createPlaylist(name, ids) {
      const playlist = { id: nextId(), name: name.trim() || '새 플레이리스트', track_ids: ids, shared: false };
      playlists = [...playlists, playlist];
      activeId = playlist.id;
      return copy(playlist);
    },
    async savePlaylist(id, name, ids) {
      if (FAIL === 'save' && failedSaves < 2) {
        failedSaves += 1;
        throw new ApiError('upstream', 502);
      }
      const saved = { ...find(id), name, track_ids: ids };
      playlists = playlists.map((p) => (p.id === id ? saved : p));
      activeId = id;
      return copy(saved);
    },
    async deletePlaylist(id) {
      find(id);
      playlists = playlists.filter((p) => p.id !== id);
      // 서버와 같다: 목록이 하나도 없으면 기본을 새로 만들고, 활성은 가장 최근 목록이다.
      if (playlists.length === 0) playlists = [{ id: nextId(), name: '기본', track_ids: [], shared: false }];
      if (activeId === id) activeId = playlists.at(-1).id;
      return { active_id: activeId };
    },
    async setActive(id) {
      find(id);
      activeId = id;
      return { active_id: activeId };
    },
    async deleteTrack(id) {
      library = library.filter((t) => t.id !== id);
      playlists = playlists.map((p) => ({ ...p, track_ids: p.track_ids.filter((x) => x !== id) }));
      media = Object.fromEntries(Object.entries(media).filter(([key]) => Number(key) !== id));
      notes = Object.fromEntries(Object.entries(notes).filter(([key]) => Number(key) !== id));
    },
    async renameTrack(id, title) {
      const track = findTrack(id);
      const renamed = { ...track, title };
      library = library.map((t) => (t.id === id ? renamed : t));
      return { id, title };
    },
    async setShared(id, shared) {
      adminOnly();
      find(id);
      playlists = playlists.map((p) => (p.id === id ? { ...p, shared } : p));
      return { id, shared };
    },
    async file(id) {
      if (SLOW) await new Promise((resolve) => setTimeout(resolve, SLOW));
      if (FAIL === 'expired') throw new ApiError('expired', 401);
      if (FAIL === 'too_big' && id === TOO_BIG_ID) throw new ApiError('too_big', 413);
      const res = await fetch(AUDIO_URL);
      if (!res.ok) throw new ApiError('upstream', res.status);
      return res.blob();
    },
    // 쪽마다 번호를 적어 넣어 서로 구별되게 한다.
    async sheet(id, page) {
      if (SLOW) await new Promise((resolve) => setTimeout(resolve, SLOW));
      const res = await fetch(SHEET_URL);
      if (!res.ok) throw new ApiError('upstream', res.status);
      const svg = (await res.text()).replace(
        '</svg>',
        `<text x="50%" y="50%" text-anchor="middle" font-size="64" fill="#c00">${page + 1}</text></svg>`,
      );
      return new Blob([svg], { type: 'image/svg+xml' });
    },
    async uploadSheet(id) {
      adminOnly();
      const current = media[id] ?? {};
      const count = (current.sheet_count ?? 0) + 1;
      if (count > SHEET_MAX_PAGES) throw new ApiError('too_many', 409);
      const version = nextVersion();
      media = { ...media, [id]: { video_id: current.video_id ?? null, sheet_version: version, sheet_count: count } };
      return { version, count };
    },
    async deleteSheet(id, page) {
      adminOnly();
      const current = media[id] ?? {};
      if (page < 0 || page >= (current.sheet_count ?? 0)) throw new ApiError('not_found', 404);
      const count = (current.sheet_count ?? 0) - 1;
      const version = nextVersion();
      media = {
        ...media,
        [id]: { video_id: current.video_id ?? null, sheet_version: count === 0 ? null : version, sheet_count: count },
      };
      return { version, count };
    },
    async saveVideo(id, url) {
      adminOnly();
      const trimmed = url.trim();
      const videoId = trimmed ? (VIDEO_ID_RE.exec(trimmed)?.[1] ?? null) : null;
      if (trimmed && !videoId) throw new ApiError('bad_request', 400);
      media = { ...media, [id]: { sheet_version: media[id]?.sheet_version ?? null, video_id: videoId } };
      return { video_id: videoId };
    },
    async lyrics(id) {
      return copy(lyricsState[id] ?? { status: 'unknown' });
    },
    async lyricsCandidates(id, q) {
      return copy({ q: q ?? '주님은 나의 목자', candidates: FAKE_CANDIDATES });
    },
    async chooseLyrics(id) {
      adminOnly();
      lyricsState = { ...lyricsState, [id]: { status: 'found', synced: FAKE_LRC, offset_ms: 0 } };
      return copy(lyricsState[id]);
    },
    async saveLyricsOffset(id, offsetMs) {
      adminOnly();
      const offset = Math.max(-LYRICS_OFFSET_LIMIT, Math.min(LYRICS_OFFSET_LIMIT, offsetMs));
      lyricsState = { ...lyricsState, [id]: { ...lyricsState[id], offset_ms: offset } };
      return { offset_ms: offset };
    },
    async saveNote(id, body) {
      if (FAIL === 'note' && failedNotes < 2) {
        failedNotes += 1;
        throw new ApiError('upstream', 502);
      }
      if (body) notes = { ...notes, [id]: body };
      else notes = Object.fromEntries(Object.entries(notes).filter(([key]) => Number(key) !== id));
    },
    async listUsernames() {
      adminOnly();
      if (FAIL === 'users') throw new ApiError('upstream', 502);
      return copy({ usernames });
    },
    async addUsername(username) {
      adminOnly();
      if (FAIL === 'users') throw new ApiError('upstream', 502);
      const name = cleanUsername(username);
      if (!name) throw new ApiError('bad_request', 400);
      if (!usernames.some((r) => r.username === name)) {
        usernames = [...usernames, { username: name, seen: false, is_admin: false, is_owner: false }];
      }
      return { username: name };
    },
    async removeUsername(name) {
      adminOnly();
      if (FAIL === 'users') throw new ApiError('upstream', 502);
      if (!usernames.some((r) => r.username === name)) throw new ApiError('not_found', 404);
      usernames = usernames.filter((r) => r.username !== name);
    },
    // 원래 관리자만 바꾼다. 미니앱을 한 번도 안 연 사람은 409.
    async setUserAdmin(name, admin) {
      if (!IS_OWNER) throw new ApiError('forbidden', 403);
      const row = usernames.find((r) => r.username === name);
      if (!row) throw new ApiError('not_found', 404);
      if (!row.seen) throw new ApiError('not_seen', 409);
      usernames = usernames.map((r) => (r.username === name ? { ...r, is_admin: admin } : r));
      return { username: name, is_admin: admin };
    },
  };
}
