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

export function createApi(baseUrl, initData, fileBase = null) {
  async function request(method, path, body, extra = {}) {
    const headers = { 'X-Telegram-Init-Data': initData };
    const init = { method, headers, ...extra };
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
    // AbortSignal.timeout이 없는 오래된 웹뷰에서는 시간 상한 없이 받는다.
    // 파일은 Oracle에서 받는다. 서버가 응답하지 않을 때만 Supabase 함수로 받는다. 권한·없는 곡 응답은 그대로 오류다.
    file: async (id) => {
      if (fileBase) {
        try {
          const res = await fetch(`${fileBase}/tracks/${id}/file`, {
            headers: { 'X-Telegram-Init-Data': initData },
            signal: AbortSignal.timeout?.(FILE_TIMEOUT_MS),
          });
          if (res.ok) return await res.blob();
          if (res.status < 500) throw new ApiError(await errorCode(res), res.status);
        } catch (err) {
          if (err instanceof ApiError) throw err;
        }
      }
      return (await request('GET', `/tracks/${id}/file`, undefined, { signal: AbortSignal.timeout?.(FILE_TIMEOUT_MS) })).blob();
    },
  };
}
