// localhost 시험용 가짜 API. app.js가 localhost일 때만 불러온다.
// ?fail=too_big · ?fail=expired · ?fail=save 로 오류 장면을 만든다.
import { ApiError } from './api.js';

const FAIL = new URLSearchParams(location.search).get('fail');
const TOO_BIG_ID = 2;
const AUDIO_URL = '../bgtest.mp3';

export function createApi() {
  let library = [1, 2, 3, 4, 5].map((id) => ({ id, title: `시험 곡 ${id}`, duration: 60 + id }));
  let playlists = [
    { id: 1, name: '기본', track_ids: [1, 2, 3] },
    { id: 2, name: '밤', track_ids: [4, 5] },
  ];
  let activeId = 1;
  let failedSaves = 0;

  const copy = (value) => structuredClone(value);
  const nextId = () => Math.max(0, ...playlists.map((p) => p.id)) + 1;
  const find = (id) => {
    const playlist = playlists.find((p) => p.id === id);
    if (!playlist) throw new ApiError('not_found', 404);
    return playlist;
  };

  return {
    async state() {
      return copy({ library, playlists, active_id: activeId });
    },
    async createPlaylist(name, ids) {
      const playlist = { id: nextId(), name: name.trim() || '새 플레이리스트', track_ids: ids };
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
      if (activeId === id) activeId = playlists.at(-1)?.id ?? null;
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
    },
    async file(id) {
      if (FAIL === 'expired') throw new ApiError('expired', 401);
      if (FAIL === 'too_big' && id === TOO_BIG_ID) throw new ApiError('too_big', 413);
      const res = await fetch(AUDIO_URL);
      if (!res.ok) throw new ApiError('upstream', res.status);
      return res.blob();
    },
  };
}
