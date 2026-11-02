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

export function createApi(baseUrl, initData) {
  async function request(method, path, body) {
    const headers = { 'X-Telegram-Init-Data': initData };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + path, init);
    if (!res.ok) throw new ApiError(await errorCode(res), res.status);
    return res;
  }

  const json = async (method, path, body) => (await request(method, path, body)).json();

  return {
    state: () => json('GET', '/state'),
    createPlaylist: (name, ids) => json('POST', '/playlists', { name, track_ids: ids }),
    savePlaylist: (id, name, ids) => json('PUT', `/playlists/${id}`, { name, track_ids: ids }),
    deletePlaylist: (id) => json('DELETE', `/playlists/${id}`),
    setActive: (id) => json('PUT', '/active', { playlist_id: id }),
    deleteTrack: async (id) => {
      await request('DELETE', `/tracks/${id}`);
    },
    file: async (id) => (await request('GET', `/tracks/${id}/file`)).blob(),
  };
}
