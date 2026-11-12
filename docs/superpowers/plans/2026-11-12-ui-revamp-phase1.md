# UI 개편 단계 1 구현 계획

**목표:** 미니앱 화면을 시안(맑은 유리, 탭 4개, 미니/전체 플레이어)으로 교체한다. 서버 API는 그대로 둔다.

**구조:** 순수 로직 모듈은 재사용한다. 화면은 탭별 모듈로 새로 쓴다. `app.js`는 상태와 조립만 맡는다.

**기술:** 바닐라 ES 모듈, CSS 한 파일, Sortable 1.15.6(지금 CDN 그대로), 텔레그램 WebApp SDK.

**설계:** `docs/superpowers/specs/2026-11-12-ui-revamp-design.md`

**시안 원본:** `design/prototype/loopbot-film.html` (CSS 토큰과 마크업 참고)

## 공통 제약

- 브랜치 `ui-revamp`에서만 작업한다. main은 건드리지 않는다.
- 서버 API(`webapp/api.js`의 메서드)와 응답 모양은 바꾸지 않는다.
- 재사용 모듈은 동작을 바꾸지 않는다: `api.js store.js saver.js queue.js audio.js copy.js note-export.js note-actions.js lyrics-logic.js users-logic.js users-admin.js volume.js`
- 문구는 한국어 -요체, 짧게. `copy.js`에 모은다.
- 색 토큰은 시안 `:root`를 그대로 쓴다: `--ink #14202B`, `--muted #4D5A66`, `--glass rgba(255,255,255,.42)` 등.
- 움직임은 `transform`과 `opacity`만 쓴다. `prefers-reduced-motion`이면 끈다.
- 안전 영역은 지금 `index.html`의 `--inset-top/bottom/left/right` 계산을 그대로 옮긴다.
- 테스트: 각 작업이 끝날 때 `node --test 'tests/webapp/*.test.mjs'` 전부 통과.

## 검토 초점

1. 공유받은 목록(읽기 전용)에서 편집 버튼이 보이거나 동작하면 안 된다.
2. 목록을 지우거나 곡을 지운 뒤 재생 중인 곡과 큐가 어긋나면 안 된다. 지금 `app.js`의 처리를 그대로 옮긴다.
3. 화면을 옆으로 밀어도 탭이 바뀌면 안 된다. `#pager`는 `overflow: hidden`이고 탭은 버튼으로만 바꾼다. 묵상 곡 넘김에는 `overscroll-behavior-x: contain`을 준다.
4. 메모 입력 중에는 키보드에 바가 가려지지 않게 숨긴다.
5. iOS에서는 볼륨 버튼이 숨겨지는 지금 동작을 유지한다.

---

### 작업 1: 화면 순수 로직 (`webapp/ui-logic.js`)

**파일:** 만들기 `webapp/ui-logic.js`, 테스트 `tests/webapp/ui-logic.test.mjs`

**내보내는 것:**
- `MOOD_PALETTES`: 길이 5 배열. 각 원소는 `[m1, m2, m3]` hex 문자열이다. 값은 시안 SONGS의 m 다섯 벌 그대로.
- `moodFor(trackId: number): string[]`: `MOOD_PALETTES[Math.abs(trackId) % 5]`
- `tabFromScroll(scrollLeft: number, width: number, count: number): number`: 반올림한 칸 번호를 `0..count-1`로 자른다. width가 0이면 0.
- `indicatorX(scrollLeft: number, width: number, tabWidth: number): number`: `width ? scrollLeft / width * tabWidth : 0`
- `loopCheck(position: number, loop: {a: number, b: number} | null): number | null`: loop가 있고 `b > a`이며 `position >= b`이면 `a`를 돌려준다. 그 밖에는 `null`.
- `meditateTrack({ chosenId, currentId, trackIds }): number | null`: 고른 곡이 trackIds에 있으면 그 곡, 없으면 currentId, 그것도 없으면 첫 곡, 비었으면 null.
- `SPEEDS = [0.75, 0.9, 1, 1.1]`

- [ ] 실패하는 테스트를 먼저 쓴다. 각 함수당 경계를 포함한 2~3개. 예: `tabFromScroll(1170, 390, 4) === 3`, `tabFromScroll(5000, 390, 4) === 3`, `loopCheck(30, {a: 10, b: 20}) === 10`, `loopCheck(30, {a: 20, b: 10}) === null`, `meditateTrack({chosenId: 9, currentId: 2, trackIds: [1, 2]}) === 2`
- [ ] 구현해서 통과시킨다.
- [ ] 커밋: `feat: 새 화면용 순수 로직`

### 작업 2: 재생기에 속도와 위치 이동 추가 (`webapp/audio.js`)

**파일:** 고치기 `webapp/audio.js`, 테스트 `tests/webapp/audio.test.mjs`에 추가

**추가하는 메서드 (createPlayer가 돌려주는 객체):**
- `setRate(rate: number): void`: `audio.playbackRate = rate`. 곡이 바뀌어도 유지한다.
- `rate(): number`
- `seek(seconds: number): void`: `0..duration`으로 잘라 `audio.currentTime`에 넣는다.

- [ ] 실패하는 테스트: 곡을 바꾼 뒤에도 rate 유지, seek 범위 자르기 (기존 테스트의 가짜 Audio 방식을 따른다)
- [ ] 구현한다. 기존 테스트도 전부 통과해야 한다.
- [ ] 커밋: `feat: 재생 속도와 위치 이동`

### 작업 3: 화면 뼈대와 스타일 (`webapp/index.html`, `webapp/app.css`)

**파일:**
- `webapp/index.html`을 새로 쓴다.
- `webapp/app.css`를 만든다.
- 지운다: `webapp/glass.css`. `volume.css` 내용은 `app.css`에 합친다.

**마크업 (id는 이 이름으로 고정):**
- `#ambient`
- `#pager`, 그 안에 `section.pane` 네 개: `#tab-conti`, `#tab-library`, `#tab-meditate`, `#tab-practice`
- `#dock` 안에:
  - `#mini`: `#mini-open`, `#mini-art`, `#mini-title`, `#mini-sub`, `#mini-play`, `#mini-next`, `#mini-prog`
  - `nav#tabs`: `#tab-ind`, `button.tab` 네 개
- `section#player`: `#player-close`, `#player-hero`, `#player-title`, `#player-sub`, `#player-art`, `#seek`(input range), `#t-now`, `#t-all`, `#repeat`, `#prev`, `#play`, `#next`, 볼륨 마크업(지금 `index.html`의 `#volume…`를 그대로 옮김), `#video-open`
- `#video-panel`: 지금 마크업을 그대로 옮긴다. `#player` 위에 뜬다.
- dialog: `#sheet-viewer`, `#template-dialog`, `#users-dialog`는 지금 마크업을 그대로 옮긴다. 새로 `#list-dialog`(목록 바꾸기), `#menu-dialog`(⋯ 메뉴), `#name-dialog`(이름 입력), `#settings-dialog`를 만든다.
- 시작 스크립트와 SDK 로딩 순서는 지금 `index.html`과 같게 둔다. 스킨을 정하던 인라인 스크립트는 지운다.

**CSS:** 시안 `<style>`의 토큰과 클래스(`.glass .pane .row .thumb .chip .seg .memo .sheets .dock .mini .tabs .tab .ind .player .console .ctl .play`)를 옮긴다. 다음을 더한다.
- `@supports not (backdrop-filter: blur(1px))`: `.glass`를 `rgba(255,255,255,.92)`로
- `@media (min-width: 760px)`: `.app`을 `max-width: 480px`로 가운데에 둔다
- `body:has(textarea:focus, input[type=text]:focus) #dock { display: none }`

- [ ] 뼈대와 CSS를 쓴다. 이 단계에서는 `app.js`가 아직 옛 id를 찾으므로 화면이 깨져도 된다.
- [ ] 커밋: `feat: 새 화면 뼈대와 스타일`

### 작업 4: 탭 이동과 미니·전체 플레이어 (`webapp/shell.js`)

**파일:** 만들기 `webapp/shell.js`

**내보내는 것:** `createShell({ onTab }): { goTab(i: number): void, tab(): number, openPlayer(): void, closePlayer(): void, isPlayerOpen(): boolean, setMood(trackId: number): void }`
- `#pager`는 `overflow: hidden`이라 사용자가 밀어서 넘길 수 없다. 탭 버튼을 누를 때만 `goTab`이 `scrollTo`로 넘긴다.
- `#pager`의 scroll 이벤트(프로그램 이동으로만 생김)로 `tabFromScroll`과 `indicatorX`를 써서 알약 위치, `aria-current`, 칸 투명도·크기를 갱신한다. 탭이 바뀌면 `onTab(i)`를 부른다.
- 탭 버튼을 누르면 `goTab`이 부드럽게 넘긴다. 움직임 줄이기 설정이면 바로 넘긴다.
- `setMood`는 `moodFor`로 `.app`의 `--m1..3`을 바꾼다.
- 창 크기가 바뀌면 지금 칸으로 다시 맞춘다.

- [ ] 구현한다. 순수 계산은 작업 1 함수만 쓴다.
- [ ] 커밋: `feat: 탭 넘김과 플레이어 열고 닫기`

### 작업 5: 탭 화면 모듈

**파일:** 만들기 `webapp/tab-conti.js`, `webapp/tab-library.js`, `webapp/tab-meditate.js`, `webapp/tab-practice.js`, `webapp/menus.js`

**공통 모양:** 각 모듈은 `create…({ ...handlers })`가 `{ render(view) }`를 돌려준다. `view`는 `app.js`가 만드는 읽기 전용 객체다. DOM은 `textContent`로만 채운다(`innerHTML`에 데이터를 넣지 않는다).

- `createConti({ onPlay, onReorder, onRemove, onOpenLists, onListMenu })`
  - view: `{ listName, isOwn, shared, trackIds, titles, currentId, unplayable }`
  - 내 목록일 때만 Sortable을 켜고 빼기 버튼을 보인다.
- `createLibrary({ onPlay, onOpenList, onNewList, onTrackMenu })`
  - view: `{ library, playlists, sharedPlaylists, currentId, query }`
  - 검색은 모듈 안에서 제목 `includes`로 거른다.
- `createMeditate({ api, onError, onMediaChange, noteActions })`
  - view: `{ trackIds, titles, media, notes, currentId, canEdit, playlistId }`
  - 곡마다 한 장(`article.slide`)을 가로로 늘어놓고 scroll-snap으로 한 곡씩 넘긴다. 처음 칸은 `meditateTrack`으로 정한다. 위에 `n / 전체`, 아래에 점 표시.
  - PC 마우스 끌기: pointerType이 mouse일 때만 끌어서 넘기고 놓으면 가까운 곡에 붙인다. 6px 넘게 끈 뒤의 click은 막는다. textarea 안에서 시작한 끌기는 무시한다.
  - 메모는 곡마다 하나다. 가사 보기와 악보 보기의 메모 칸은 같은 값을 쓴다. 악보 사진은 그 곡 칸 안에서 아래로 이어 붙인다.
  - 느낀점 저장, 초안 복구, 복사, 템플릿은 지금 `lyrics.js`의 코드를 옮긴다(`saveNote`, `draftsToRestore`, `note-actions`).
  - 악보 넘김, 캐시, 업로드, 삭제, 크게 보기도 지금 `lyrics.js` 코드를 옮긴다(`sheetCacheKey`, `pageFromScroll`, `pagesToLoad`, `fitSize`, `uploadSheet`, `deleteSheet`).
- `createPractice({ player })`: 속도 버튼은 `player.setRate`, 구간 반복 A/B/해제 버튼. 반복 판정은 `loopCheck`(작업 1)를 timeupdate에서 부른다.
- `menus.js`: `openListPicker(view): Promise<id|null>`, `openMenu(items: {label, danger?, run}[]): void`, `askName({ value, title, max }): Promise<string|null>`. 지금 `prompt()`를 쓰는 곳은 없어야 한다.

- [ ] 모듈마다 구현하고, 옮겨 온 로직의 테스트(lyrics-logic, note-export, note-actions)가 계속 통과하는지 본다.
- [ ] 커밋은 모듈마다 하나씩: `feat: 콘티 탭` 등

### 작업 6: `app.js` 조립과 옛 모듈 정리

**파일:**
- 고치기: `webapp/app.js`, `webapp/copy.js`
- 지우기: `webapp/render.js`, `webapp/lyrics.js`, `webapp/desk.js`, `webapp/desk-layout.js`, `webapp/video-float.js`, `tests/webapp/desk-layout.test.mjs`

**app.js가 맡는 것** (지금 함수의 동작을 그대로 유지하며 옮긴다):
- 텔레그램 초기화: ready, expand, swipes, theme
- 상태 불러오기와 새로고침: `refreshFromServer`
- 목록: 만들기, 저장(`createSaves`), 공유, 지우기, 활성 목록 전송(`createActiveSender`)
- 곡: 이름 바꾸기, 지우기
- 큐와 재생: `nextTrack`, `prevTrack`, ended/failed 처리
- 볼륨: `initVolume`
- 사용자 관리: `createUsersAdmin`. 설정 창 안에 넣는다.
- 참고 영상 패널: `embedUrl` 사용
- 미니·전체 플레이어 표시를 갱신하고, 곡이 바뀌면 `shell.setMood`를 부른다.
- 탭 모듈에 view를 넘긴다.

스킨 관련 코드(`KEY_SKIN`, `SKIN_GLASS`, `onToggleSkin`)와 데스크 관련 코드는 지운다.

- [ ] 조립한다. `node --test` 전부 통과를 확인한다.
- [ ] `fake-api.js`로 로컬 미리보기를 띄워 폰 폭(375)과 넓은 화면(1280)에서 확인한다:
  - 각 탭과 탭 넘김
  - 재생, 다음, 반복, 위치 이동, 속도, 구간 반복
  - 목록 만들기, 이름 바꾸기, 공유, 지우기
  - 곡 이름 바꾸기와 지우기
  - 악보 넘기기, 업로드, 삭제
  - 느낀점 저장과 전체 복사
  - 참고 영상 열기
  - 관리자 사용자 관리
- [ ] 커밋: `feat: 새 화면 조립, 옛 화면 모듈 제거`

### 작업 7: 검토

- [ ] `plan-reviewer`로 전체 diff를 검토한다. 이 계획과 검토 초점 5개를 기준으로 본다.
- [ ] 높음 이상 지적은 고치고 다시 확인한다.
- [ ] 배포는 하지 않는다. 사용자가 "배포"라고 하면 main에 합친다.
