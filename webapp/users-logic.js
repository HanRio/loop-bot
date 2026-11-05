// 관리자 사용자 목록에 넣을 텔레그램 아이디를 다듬는다. 맞지 않으면 null.
const USERNAME_RE = /^[a-z0-9_]{5,32}$/;

export function cleanUsername(raw) {
  const name = raw.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(name) ? name : null;
}

// 줄마다 보일 버튼. 토글은 원래 관리자가 아니면 없고, 지우기는 원래 관리자 줄을 빼고 막는다.
export function userRowActions(row, isOwner) {
  const canRemove = isOwner ? !row.is_owner : !(row.is_admin || row.is_owner);
  if (!isOwner || row.is_owner) return { toggle: null, canRemove };
  if (!row.seen && !row.is_admin) return { toggle: 'waiting', canRemove };
  return { toggle: row.is_admin ? 'revoke' : 'grant', canRemove };
}

// 같은 아이디 줄은 바꾸고 아이디 순으로 정렬한 새 배열을 돌려준다.
export function withRow(rows, row) {
  const others = rows.filter((r) => r.username !== row.username);
  return [...others, row].sort((a, b) => (a.username < b.username ? -1 : 1));
}
