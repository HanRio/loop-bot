// 가사집 화면의 순수 계산. DOM과 네트워크는 모른다.

// 긴 변이 max를 넘으면 비율을 지켜 줄인 정수 크기. 넘지 않으면 그대로다.
export function fitSize(width, height, max) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// 카드 구조가 바뀔 때만 달라지는 값. 제목과 느낀점은 넣지 않는다. 그래야 입력 중에 카드가 다시 그려지지 않는다.
export function feedKey(playlistId, trackIds, media, isOwner) {
  const rows = trackIds.map((id) => [id, media[id]?.sheet_version ?? null, media[id]?.video_id ?? null]);
  return JSON.stringify([playlistId, isOwner, rows]);
}

// 임시 글 중 서버 값과 다른 것만 되살린다. 서버 값이 없으면 빈 글과 같다.
export function draftsToRestore(drafts, serverNotes) {
  return Object.fromEntries(Object.entries(drafts).filter(([id, body]) => body !== (serverNotes[id] ?? '')));
}

// 보고 있는 목록을 고칠 수 있는지. ownIds는 내 목록 id 배열이다.
export function isWritable(playlist, ownIds) {
  return Boolean(playlist) && ownIds.includes(playlist.id);
}

export function embedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?playsinline=1&rel=0`;
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

// Cache Storage 키. 사진을 바꾸면 version이 올라 옛 사진은 다시 받지 않는다.
export function sheetCacheKey(trackId, version) {
  return `sheet-${trackId}-${version}`;
}
