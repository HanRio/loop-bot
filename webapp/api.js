// 함수 API 호출만 한다. 상태나 화면은 모른다.

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function errorCode(res) {
  try {
    const body = await res.json();
    return typeof body.error === 'string' ? body.error : 'upstream';
  } catch {
    // 함수가 JSON이 아닌 응답을 주는 경우(게이트웨이 오류 등)
    return 'upstream';
  }
}

// 곡 한 개를 받는 시간 상한. 멈춘 요청이 같은 곡의 재시도를 막지 않게 한다. 본문을 읽는 동안도 걸린다.
const FILE_TIMEOUT_MS = 120000;
// 파일 서버가 처음 받는 곡은 텔레그램에서 다 받은 뒤 응답한다. 곡이 끊기지 않게 짧게 잡는다.
const ORACLE_RESPONSE_MS = 15000;

export function createApi(baseUrl, initData, fileBase = null) {
  async function request(method, path, body, extra = {}) {
    const headers = { 'X-Telegram-Init-Data': initData, ...extra.headers };
    const init = { method, ...extra, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + path, init);
    if (!res.ok) throw new ApiError(await errorCode(res), res.status);
    return res;
  }

  const json = async (method, path, body) => (await request(method, path, body)).json();

  // 응답 머리가 늦으면 서버가 멈춘 것으로 보고 끊는다. 본문을 받는 동안은 전체 상한만 걸린다.
  async function fromOracle(path) {
    const controller = new AbortController();
    const noResponse = setTimeout(() => controller.abort(), ORACLE_RESPONSE_MS);
    const tooLong = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const res = await fetch(`${fileBase}${path}`, {
        headers: { 'X-Telegram-Init-Data': initData },
        signal: controller.signal,
      });
      clearTimeout(noResponse);
      if (res.ok) return await res.blob();
      if (res.status < 500) throw new ApiError(await errorCode(res), res.status);
      return null;
    } finally {
      clearTimeout(noResponse);
      clearTimeout(tooLong);
    }
  }

  // 곡과 사진 받기. 파일 서버(Oracle)를 먼저 쓰고, 5xx나 네트워크 오류면 함수로 받는다.
  // AbortSignal.timeout이 없는 오래된 웹뷰에서는 시간 상한 없이 받는다. 권한·없는 곡 응답은 그대로 오류다.
  async function fetchFile(path) {
    if (fileBase) {
      try {
        const res = await fromOracle(path);
        if (res) return res;
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }
    return (await request('GET', path, undefined, { signal: AbortSignal.timeout?.(FILE_TIMEOUT_MS) })).blob();
  }

  return {
    state: () => json('GET', '/state'),
    createPlaylist: (name, ids) => json('POST', '/playlists', { name, track_ids: ids }),
    savePlaylist: (id, name, ids) => json('PUT', `/playlists/${id}`, { name, track_ids: ids }),
    deletePlaylist: (id) => json('DELETE', `/playlists/${id}`),
    setActive: (id) => json('PUT', '/active', { playlist_id: id }),
    deleteTrack: async (id) => {
      await request('DELETE', `/tracks/${id}`);
    },
    renameTrack: (id, title) => json('PUT', `/tracks/${id}`, { title }),
    setShared: (id, shared) => json('PUT', `/playlists/${id}/shared`, { shared }),
    file: (id) => fetchFile(`/tracks/${id}/file`),
    // 쪽은 0부터 센다. 응답은 {version, count}.
    sheet: (id, page) => fetchFile(`/tracks/${id}/sheet/${page}`),
    // 사진은 JPEG 바이트 그대로 보낸다. 한 쪽씩 뒤에 붙는다.
    uploadSheet: (id, blob) =>
      request('POST', `/tracks/${id}/sheet`, undefined, { body: blob, headers: { 'Content-Type': 'image/jpeg' } }).then((res) => res.json()),
    deleteSheet: (id, page) => json('DELETE', `/tracks/${id}/sheet/${page}`),
    saveVideo: (id, url) => json('PUT', `/tracks/${id}/video`, { url }),
    lyrics: (id) => json('GET', `/tracks/${id}/lyrics`),
    lyricsCandidates: (id, q) => json('GET', `/tracks/${id}/lyrics/candidates${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`),
    chooseLyrics: (id, lrclibId) => json('PUT', `/tracks/${id}/lyrics`, { lrclib_id: lrclibId }),
    saveLyricsText: (id, text) => json('PUT', `/tracks/${id}/lyrics`, { text }),
    saveLyricsOffset: (id, offsetMs) => json('PUT', `/tracks/${id}/lyrics/offset`, { offset_ms: offsetMs }),
    saveNote: async (id, body) => {
      await request('PUT', `/tracks/${id}/note`, { body });
    },
    // 관리자만 쓴다. 텔레그램 아이디 목록.
    listUsernames: () => json('GET', '/admin/usernames'),
    addUsername: (username) => json('POST', '/admin/usernames', { username }),
    removeUsername: async (name) => {
      await request('DELETE', `/admin/usernames/${encodeURIComponent(name)}`);
    },
    setUserAdmin: (name, admin) => json('PUT', `/admin/usernames/${encodeURIComponent(name)}/admin`, { admin }),
  };
}
