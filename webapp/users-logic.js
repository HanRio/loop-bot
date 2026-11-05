// 관리자 사용자 목록에 넣을 텔레그램 아이디를 다듬는다. 맞지 않으면 null.
const USERNAME_RE = /^[a-z0-9_]{5,32}$/;

export function cleanUsername(raw) {
  const name = raw.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(name) ? name : null;
}
