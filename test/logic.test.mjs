// 실행: node test/logic.test.mjs   (의존성 없음)
// 기대값은 손으로 계산한 값입니다(계산 과정은 각 테스트 주석).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const TODAY = new Date(2026, 8, 28); // 2026-09-28

function dw(id, o) { return Object.assign({ id, partNo: id, rev: 'A', partName: 'MAIN 하네스', customer: 'A', model: 'X1', usage: 'MAIN' }, o); }

console.log('정보 추출 (FR-02)');
test('UI 시안 제목란 문장에서 필드 추출', () => {
  const t = 'PART NO. HN-A0231 · REV C · TITLE: HARNESS ASSY-MAIN · MODEL X1 · CUST. A · APPLY: ???\nCIRCUITS: 38 BRANCHES: 6\nCN-0221 CN-0118 OPT-2';
  const r = L.extractFields(t, 'HN-A0231_C.pdf');
  assert.equal(r.fields.partNo, 'HN-A0231');
  assert.equal(r.fields.rev, 'C');
  assert.equal(r.fields.partName, 'HARNESS ASSY-MAIN');
  assert.equal(r.fields.model, 'X1');
  assert.equal(r.fields.customer, 'A');
  assert.equal(r.fields.circuits, 38);
  assert.equal(r.fields.branches, 6);
  assert.equal(r.fields.connectors, 'CN-0221, CN-0118'); // 품번 자신(HN-A0231)은 뺌
  assert.equal(r.fields.keywords, 'OPT-2');
  // APPLY: ??? 는 미인식 → 품명의 MAIN 으로 추정(guess)
  assert.equal(r.fields.usage, 'MAIN');
  assert.equal(r.source.usage, 'guess');
});
test('REVISION 라벨이 REV 로 잘못 잘리지 않고, 먼저 나온 라벨을 씀', () => {
  const r = L.extractFields('도번: HN-B0412 개정: A 품명: ENGINE 하네스 REVISION: B', 'x.pdf');
  assert.equal(r.fields.partNo, 'HN-B0412');
  assert.equal(r.fields.rev, 'A');
  assert.equal(r.fields.partName, 'ENGINE 하네스');
});
test('글자가 없으면 파일명 규칙으로 품번·REV, 나머지는 미인식', () => {
  const r = L.extractFields('', 'HN-B0412_A.pdf');
  assert.equal(r.fields.partNo, 'HN-B0412');
  assert.equal(r.fields.rev, 'A');
  assert.equal(r.source.partNo, 'file');
  assert.deepEqual(r.missing, ['partName', 'customer', 'model', 'usage']);
});

console.log('중복 확인 (FR-01)');
test('파일 해시 — FNV-1a("a") = e40c292c', () => {
  assert.equal(L.fileHash(new Uint8Array([0x61])), 'e40c292c-1');
});
test('파일명·해시·품번+REV 기준 중복', () => {
  const list = [{ id: 'D1', fileName: 'x.pdf', fileHash: 'h1', partNo: 'P1', rev: 'A' }];
  assert.deepEqual(L.findDuplicates(list, { id: '', fileName: 'X.PDF', fileHash: 'h1', partNo: 'p1', rev: 'a' })[0].reasons, ['파일명', '해시', '품번·REV']);
  assert.equal(L.findDuplicates(list, { id: '', fileName: 'y.pdf', fileHash: 'h2', partNo: 'P1', rev: 'B' }).length, 0);
});

console.log('유사도 (FR-04, 가중치 25/20/30/15/10)');
const A = dw('A', { connectors: 'C1, C2, C3', keywords: 'K1, K2', circuits: 10, branches: 4 });
const B = dw('B', { model: 'X1-L', connectors: 'C1, C2, C4', keywords: 'K1', circuits: 8, branches: 4 });
test('항목별 점수 손계산: 25 / 20 / 15 / 7.5 / 9 → 총점 77', () => {
  // 제품군: 고객사 동일 0.5 + 파생 기종(X1/X1-L) 0.5 = 1 → 25
  // 사용처: 사용처 동일 0.6 + 품명 낱말 겹침 1 × 0.4 = 1 → 20
  // 부품: {C1,C2,C3} vs {C1,C2,C4} = 2/4 → 0.5 × 30 = 15
  // 문자: {K1,K2} vs {K1} = 1/2 → 7.5
  // 형상: 회로 1-2/10=0.8, 분기 1 → 평균 0.9 × 10 = 9
  const s = L.scorePair(A, B);
  assert.deepEqual(s.items, { family: 25, usage: 20, parts: 15, text: 7.5, shape: 9 });
  assert.equal(s.total, 77); // 76.5 반올림
});
test('다른 고객사·기종·사용처면 제품군 0, 사용처는 품명 겹침만', () => {
  const C = dw('C', { customer: 'B', model: 'Y2', usage: 'ENGINE', partName: 'ENGINE 하네스' });
  const s = L.scorePair(A, C);
  assert.equal(s.items.family, 0);
  // 품명 {MAIN,하네스} vs {ENGINE,하네스} = 1/3 → 0.4/3 × 20 = 2.666… → 2.7
  assert.equal(s.items.usage, 2.7);
  assert.equal(s.items.parts, 0);
});
test('가중치를 바꾸면 점수도 바뀜 (부품 60, 나머지 10)', () => {
  const s = L.scorePair(A, B, { family: 10, usage: 10, parts: 60, text: 10, shape: 10 });
  // 10 + 10 + 30 + 5 + 9 = 64
  assert.equal(s.total, 64);
});
test('후보 순위·제외·범위·상위 N', () => {
  const C = dw('C', { customer: 'B' });
  const D = dw('D', { model: 'Z9', usage: 'PANEL', partName: 'PANEL' });
  const all = [A, B, C, D];
  const set = L.defaultSettings();
  assert.deepEqual(L.rankCandidates(A, all, set).map(c => c.id), ['B', 'C', 'D']);
  assert.deepEqual(L.rankCandidates(Object.assign({}, A, { excluded: ['B'] }), all, set).map(c => c.id), ['C', 'D']);
  assert.deepEqual(L.rankCandidates(A, all, Object.assign({}, set, { scope: 'sameCustomer' })).map(c => c.id), ['B', 'D']);
  assert.equal(L.rankCandidates(A, all, Object.assign({}, set, { topN: 1 })).length, 1);
});
test('기준점수 판정: 이상+그룹 → 기존, 미만 → 신규', () => {
  assert.equal(L.classify([{ total: 70, groupId: 'G-001' }], 70).kind, 'existing');
  assert.equal(L.classify([{ total: 69, groupId: 'G-001' }], 70).kind, 'new');
  assert.equal(L.classify([{ total: 80, groupId: '' }], 70).kind, 'pair');
  // 1순위가 미분류라도 기준점수 이상인 2순위에 그룹이 있으면 그 그룹
  assert.equal(L.classify([{ rank: 1, total: 80, groupId: '' }, { rank: 2, total: 75, groupId: 'G-7' }], 70).groupId, 'G-7');
  assert.equal(L.classify([], 70).kind, 'new');
});

console.log('그룹 확정 (FR-05)');
test('상태 흐름: 추출 보정 필요 → 미분류 → 검토대기 → 그룹 확정', () => {
  assert.equal(L.drawingStatus({ partNo: 'P' }), '추출 보정 필요');
  const d = dw('X');
  assert.equal(L.drawingStatus(d), '미분류');
  d.analyzedAt = 't'; assert.equal(L.drawingStatus(d), '검토대기');
  d.groupId = 'G-001'; assert.equal(L.drawingStatus(d), '그룹 확정');
});
test('신규 그룹 생성·기존 그룹 연결·이력 기록', () => {
  const db = L.emptyDb();
  db.drawings.push(dw('D1'), dw('D2'), dw('D3'));
  assert.throws(() => L.confirmGroup(db, 'D1', { action: 'new', name: 'g', by: '' }), /확정자/);
  const g = L.confirmGroup(db, 'D1', { action: 'new', name: 'A X1 MAIN', by: '홍길동', memo: 'm', withIds: ['D2'] }, TODAY);
  assert.equal(g, 'G-001');
  assert.equal(db.drawings[1].groupId, 'G-001'); // 함께 묶음
  assert.equal(db.groups[0].repDrawingId, 'D1');
  L.confirmGroup(db, 'D3', { action: 'link', groupId: 'G-001', by: '홍길동' }, TODAY);
  assert.equal(db.drawings[2].groupId, 'G-001');
  assert.deepEqual(db.decisions.map(x => x.action), ['신규 그룹 생성', '기존 그룹 연결']);
  assert.equal(db.decisions[0].at, '2026-09-28 00:00');
  assert.equal(L.confirmGroup(db, 'D3', { action: 'new', name: 'n', by: 'x' }, TODAY), 'G-002');
  assert.equal(db.decisions[2].prevGroupId, 'G-001');
});

console.log('ECN · 설계변경통보서 (양식 수식과 같은 결과)');
test('증감(자동): 신규·삭제·수량변경은 후−전, 대체·사양변경은 "-"', () => {
  assert.equal(L.materialDelta({ type: '수량변경', beforeQty: 2, afterQty: 3 }), 1);
  assert.equal(L.materialDelta({ type: '신규', beforeQty: '', afterQty: 1 }), 1);
  assert.equal(L.materialDelta({ type: '삭제', beforeQty: 1, afterQty: '' }), -1);
  assert.equal(L.materialDelta({ type: '대체', beforeQty: 1, afterQty: 1 }), '-');
  assert.equal(L.materialDelta({ type: '' }), '');
});
test('유형별 건수 문구', () => {
  assert.equal(L.typeCountText([{ type: '대체' }, { type: '신규' }, { type: '대체' }]), '신규 1  /  삭제 0  /  대체 2  /  수량변경 0  /  사양변경 0');
});
test('영향도 상태(자동) 6가지', () => {
  assert.equal(L.impactStatus({ applies: '' }, TODAY), '미검토');
  assert.equal(L.impactStatus({ applies: '비해당' }, TODAY), '-');
  assert.equal(L.impactStatus({ applies: '해당', done: '2026-09-01' }, TODAY), '완료');
  assert.equal(L.impactStatus({ applies: '해당', due: '' }, TODAY), '일정 미정');
  assert.equal(L.impactStatus({ applies: '해당', due: '2026-09-27' }, TODAY), '지연');
  assert.equal(L.impactStatus({ applies: '해당', due: '2026-09-28' }, TODAY), '진행 중');
});
test('빈 양식의 종결 판정은 받은 엑셀 빈 시트 표시값과 같음', () => {
  const c = L.closureCheck(L.emptyEcn());
  assert.equal(c.apply, '누락: 제품적용일 적용조건 재고처리방안');
  assert.equal(c.materials, '변경자재 없음');
  assert.equal(c.impacts, '미검토 9건');
  assert.equal(c.horizontal, '대상 없음');
  assert.equal(c.verdict, '종결 불가');
});
test('채우면 종결 가능, 모자라면 완료 처리 제한', () => {
  const e = L.emptyEcn();
  e.applyDate = '2026-10-01'; e.applyCondition = '지정일 적용'; e.stockPlan = '소진 후 적용';
  e.materials = [{ type: '대체', stock: '미정', dept: '구매' }];
  e.impacts.forEach(i => { i.applies = '비해당'; });
  e.horizontal = [{ partNo: 'P2', applies: '검토 중' }];
  let c = L.closureCheck(e);
  assert.equal(c.materials, '미정 1건');
  assert.equal(c.horizontal, '검토 중 1건');
  assert.throws(() => L.completeEcn(e, TODAY), /완료 처리 제한/);
  e.materials[0].stock = '소진 후 적용';
  e.horizontal[0].applies = '적용';
  e.impacts[0].applies = '해당';
  assert.equal(L.closureCheck(e).impacts, '미완료 1건');
  e.impacts[0].done = '2026-09-27';
  e.materials[0].dept = '';
  assert.equal(L.closureCheck(e).materialDept, '담당부서 미정 1건'); // 원문 6.2
  e.materials[0].dept = '구매';
  c = L.closureCheck(e);
  assert.equal(c.verdict, '종결 가능');
  L.completeEcn(e, TODAY);
  assert.equal(e.status, '완료');
});
test('설계변경통보서 배치: C5 번호, D38 유형별 건수, 자재 11행이면 아래로 한 행 밀림', () => {
  const e = L.emptyEcn();
  e.ecnNo = 'ECN-T-1';
  e.materials = [{ type: '신규', afterQty: 1 }];
  let r = L.ecnReport(e, TODAY);
  assert.equal(r.rows[4][2], 'ECN-T-1');           // C5
  assert.equal(r.rows[27][1], '신규');               // B28
  assert.equal(r.rows[27][12], 1);                   // M28 증감
  assert.equal(r.rows[37][3], '신규 1  /  삭제 0  /  대체 0  /  수량변경 0  /  사양변경 0'); // D38
  assert.equal(r.rows[56][4], '누락: 제품적용일 적용조건 재고처리방안'); // E57
  assert.equal(r.rows.length, 89);
  e.materials = Array.from({ length: 11 }, () => ({ type: '대체' }));
  r = L.ecnReport(e, TODAY);
  assert.equal(r.rows[38][0], '유형별 건수 (자동)'); // A39 (한 행 밀림)
  assert.equal(r.rows.length, 90);
});

console.log('적중 검증 (양식 14) · 가져오기 · 대시보드');
test('상위 3개 후보에 정답 그룹이 있으면 적중', () => {
  const db = L.emptyDb();
  db.drawings.push(dw('G1a', { groupId: 'G-001' }), dw('Q', { answerGroup: 'G-001' }), dw('R', { customer: 'Z', model: 'Q9', usage: 'PANEL', partName: 'x', answerGroup: 'G-002' }));
  const h = L.hitCheck(db, 3);
  assert.equal(h.total, 2);
  assert.equal(h.hits, 1);
  assert.equal(h.rate, 50);
  assert.equal(h.rows[0].hitRank, 1);
});
test('열 이름 추측(도번·Rev.·고객·차종)과 가져오기', () => {
  const m = L.guessMapping(['도번', 'Rev.', '고객', '차종', '비고']);
  assert.equal(m.partNo, '도번'); assert.equal(m.rev, 'Rev.'); assert.equal(m.customer, '고객'); assert.equal(m.model, '차종');
  const db = L.emptyDb();
  const r = L.importRows(db, [{ 도번: 'P1', 'Rev.': 'A' }, { 도번: '', 'Rev.': 'B' }, { 도번: 'p1', 'Rev.': 'a' }], m, TODAY);
  assert.equal(r.added, 1);
  assert.deepEqual(r.skipped.map(s => s.row), [3, 4]); // 품번 없음, 중복
  assert.equal(db.drawings[0].id, 'DWG-0001');
});
test('예시 데이터 대시보드 수치', () => {
  const db = L.normalizeDb(Sample.build());
  const st = L.dashboard(db, TODAY);
  // 12건 중 그룹 확정 7 → 미분류 5, 검토대기 3(A0231·C0055·A0240), 진행 중 ECN 1(필수정보 미정)
  assert.equal(st.total, 12); assert.equal(st.unclassified, 5); assert.equal(st.review, 3);
  assert.equal(st.ecnOpen, 1); assert.equal(st.ecnMissing, 1);
  assert.equal(L.sheetGroups(db).length, 5);            // 머리행 + 4그룹
  assert.equal(L.sheetMaterials(db).length, 1 + 4 + 1);  // 머리행 + ECN-014 4건 + ECN-009 1건
});

console.log('도면 비교 (2026-09-29 추가 요청)');
// 작은 합성 비트맵: 문자열 격자 '#' = 선
function bm(rows) {
  const h = rows.length, w = rows[0].length, m = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') m[y * w + x] = 1; }));
  return { w, h, m };
}
test('이진화: 어두운 점만 선, 투명은 흰 바탕', () => {
  // 픽셀 4개: 검정 · 흰색 · 회색(150) · 투명한 검정
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 150, 150, 150, 255, 0, 0, 0, 0]);
  assert.deepEqual([...L.binarize(rgba, 4, 1, 160)], [1, 0, 1, 0]);
  assert.deepEqual([...L.binarize(rgba, 4, 1, 100)], [1, 0, 0, 0]);
});
test('팽창: 점 하나가 r=1 이면 3×3', () => {
  const a = bm(['.....', '.....', '..#..', '.....', '.....']);
  const d = L.dilate(a.m, a.w, a.h, 1);
  assert.equal(d.reduce((s, v) => s + v, 0), 9);
  assert.equal(d[1 * 5 + 1], 1); assert.equal(d[0], 0);
  assert.equal(L.dilate(a.m, a.w, a.h, 0).reduce((s, v) => s + v, 0), 1);
});
test('차이: 1px 어긋난 선은 허용치 1 이면 무시, B에만 있는 선은 추가·A에만 있는 선은 삭제', () => {
  const A = bm(['##########', '..........', '..........', '..........', '#.........']);
  const B = bm(['..........', '##########', '..........', '....###...', '..........']);
  const d0 = L.diffMasks(A.m, B.m, A.w, A.h, 0);
  assert.equal(d0.addedCount, 13); // 허용치 0: 한 줄 밀린 선 10 + 새 선 3 모두 차이
  const d1 = L.diffMasks(A.m, B.m, A.w, A.h, 1);
  assert.equal(d1.addedCount, 3);   // 새로 생긴 가로선 3칸만
  assert.equal(d1.removedCount, 1); // 왼쪽 아래 점은 B에서 사라짐
  assert.equal(d1.added[3 * 10 + 4], 1);
  assert.equal(d1.removed[4 * 10 + 0], 1);
});
test('연결요소: 8방향 연결·잡음 제거·가까운 조각 묶기', () => {
  const M = bm([
    '##......#.',
    '.#......#.',
    '..#.......',
    '..........',
    '..........',
    '..........',
    '......#.#.',
  ]);
  const c = L.components(M.m, M.w, M.h, { minArea: 1 });
  assert.equal(c.length, 4); // 대각선 덩어리(4) · 세로 2 · 아래 점 2개
  assert.deepEqual([c[0].x, c[0].y, c[0].w, c[0].h, c[0].area], [0, 0, 3, 3, 4]);
  assert.equal(L.components(M.m, M.w, M.h, { minArea: 2 }).length, 2); // 점 1개짜리 둘은 잡음
  const g = L.components(M.m, M.w, M.h, { minArea: 1, gap: 1 });
  assert.equal(g.length, 3); // 한 칸 떨어진 아래 점 두 개가 한 상자로
  assert.deepEqual([g[2].x, g[2].w, g[2].area], [6, 3, 2]);
});
test('차이 영역 번호: 추가·삭제를 위→아래 순서로', () => {
  const A = bm(['#.....', '......', '......']);
  const B = bm(['......', '......', '...###']);
  const r = L.diffRegions(L.diffMasks(A.m, B.m, 6, 3, 0), 6, 3, { minArea: 1 });
  assert.deepEqual(r.map(x => [x.no, x.type, x.area]), [[1, '삭제', 1], [2, '추가', 3]]);
});
test('유사변환 추정: 회전 30°·배율 2·이동을 기준점 3쌍에서 복원', () => {
  const ang = Math.PI / 6, s = 2, T0 = { a: s * Math.cos(ang), b: s * Math.sin(ang), tx: 15, ty: -4 };
  const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 7 }];
  const dst = src.map(p => L.applySimilarity(T0, p));
  const T = L.fitSimilarity(src, dst);
  assert.ok(Math.abs(T.scale - 2) < 1e-9);
  assert.ok(Math.abs(T.angle - 30) < 1e-9);
  assert.ok(Math.abs(T.tx - 15) < 1e-9 && Math.abs(T.ty + 4) < 1e-9);
  assert.ok(T.rms < 1e-9);
  // 1쌍이면 배율 고정·이동만
  const T1 = L.fitSimilarity([{ x: 10, y: 10 }], [{ x: 30, y: 25 }], 0.5);
  assert.deepEqual([T1.a, T1.b, T1.tx, T1.ty], [0.5, 0, 25, 20]);
  assert.equal(L.fitSimilarity([], []), null);
});
test('표 비교: 추가·삭제·변경 행과 순서', () => {
  const A = [{ 품번: 'CN-01', 수량: 2, 사양: 'AMP' }, { 품번: 'CN-02', 수량: 1, 사양: '' }, { 품번: 'WR-10', 수량: '3', 사양: '0.5SQ' }];
  const B = [{ 품번: 'CN-01', 수량: '2', 사양: 'AMP' }, { 품번: 'WR-10', 수량: 4, 사양: '0.5SQ' }, { 품번: 'CN-09', 수량: 1, 사양: '' }];
  const r = L.tableDiff(A, B, { key: '품번' });
  assert.deepEqual(r.rows.map(x => x.key + ':' + x.status), ['CN-01:동일', 'CN-02:삭제', 'WR-10:변경', 'CN-09:추가']);
  assert.deepEqual(r.rows[2].changed, ['수량']); // '2' 와 2 는 같은 값
  assert.deepEqual(r.counts, { 추가: 1, 삭제: 1, 변경: 1, 동일: 1 });
  assert.equal(L.sheetTableDiff(r, '품번').length, 5);
  assert.equal(L.guessKeyColumn(['No', '자재코드', '수량']), '자재코드');
  const p = L.parsePastedTable('품번\t수량\nCN-01\t2\n\nCN-02\t1\n');
  assert.deepEqual(p.headers, ['품번', '수량']); assert.equal(p.rows.length, 2); assert.equal(p.rows[1].수량, '1');
});
test('등록 도면 부품 표 비교: 커넥터 추가·REV 변경', () => {
  const a = dw('HN-A0231', { rev: 'C', connectors: 'CN-0221, CN-0118', circuits: 38 });
  const b = dw('HN-A0250', { rev: 'A', connectors: 'CN-0221, CN-0118, CN-0301', circuits: 42 });
  const r = L.tableDiff(L.drawingPartRows(a), L.drawingPartRows(b), { key: L.partRowKey, cols: ['값'] });
  const pick = s => r.rows.filter(x => x.status === s).map(x => x.key);
  assert.deepEqual(pick('추가'), ['커넥터 · CN-0301']);
  assert.deepEqual(pick('변경'), ['도면 정보 · REV', '도면 정보 · 회로 수']);
  assert.deepEqual(pick('삭제'), []);
});

console.log('도면 비교 2차 (2026-09-29 오후 — 실제 CAD PDF·BOM 기준)');
// 빈 w×h 마스크에 사각형 테두리·채운 사각형을 그리는 도우미
function blank(w, h) { return { w, h, m: new Uint8Array(w * h) }; }
function rect(b, x0, y0, x1, y1, fill) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (fill || y === y0 || y === y1 || x === x0 || x === x1) b.m[y * b.w + x] = 1; }
test('이진화: 하늘색(0,255,255) 선도 선으로 봄 — 밝기 평균이 아니라 가장 어두운 채널', () => {
  const rgba = new Uint8ClampedArray([0, 255, 255, 255, 255, 255, 200, 255]); // 하늘색 · 연노랑
  assert.deepEqual([...L.binarize(rgba, 2, 1, 160)], [1, 0]); // 밝기 평균이면 하늘색은 179 라 빠짐
});
test('도곽 찾기: 가장 바깥 긴 선 사각형, 없으면 선 외곽', () => {
  const b = blank(40, 30); rect(b, 2, 3, 37, 27); rect(b, 10, 10, 14, 14, true);
  assert.deepEqual(L.findFrame(b.m, 40, 30), { x0: 2, y0: 3, x1: 37, y1: 27, kind: 'frame' });
  const c = blank(40, 30); rect(c, 10, 10, 14, 16, true);
  assert.equal(L.findFrame(c.m, 40, 30).kind, 'ink');
  // B 도곽이 A 보다 2배 크고 (4, 6) 밀려 있으면 배율 0.5 로 되돌림
  const T = L.frameTransform({ x0: 8, y0: 12, x1: 78, y1: 60 }, { x0: 2, y0: 3, x1: 37, y1: 27 });
  assert.ok(Math.abs(T.scale - 0.5) < 1e-9 && Math.abs(T.angle) < 1e-9);
  const p = L.applySimilarity(T, { x: 8, y: 12 }); assert.ok(Math.abs(p.x - 2) < 1e-9 && Math.abs(p.y - 3) < 1e-9);
});
test('미세 이동 보정: B 가 (3, -2) 밀려 있으면 B 를 (-3, 2) 옮기라고 답함', () => {
  const A = blank(40, 30); rect(A, 5, 5, 30, 20); rect(A, 12, 8, 16, 12, true);
  const B = blank(40, 30); rect(B, 8, 3, 33, 18); rect(B, 15, 6, 19, 10, true);
  const r = L.bestShift(A.m, B.m, 40, 30, 5);
  assert.deepEqual([r.dx, r.dy, r.score], [-3, 2, 1]);
  assert.ok(r.base < 0.2);
});
test('위치만 이동한 영역 표시: 표가 (4, 3) 밀리면 moved, 값이 바뀐 곳은 아님', () => {
  const W = 60, H = 40;
  const A = blank(W, H); rect(A, 5, 5, 25, 25); for (let y = 9; y <= 21; y += 4) for (let x = 6; x <= 24; x++) A.m[y * W + x] = 1; rect(A, 40, 10, 50, 14, true);
  const B = blank(W, H); rect(B, 9, 8, 29, 28); for (let y = 12; y <= 24; y += 4) for (let x = 10; x <= 28; x++) B.m[y * W + x] = 1; rect(B, 40, 20, 50, 24, true);
  const d = L.diffMasks(A.m, B.m, W, H, 0);
  const rg = L.diffRegions(d, W, H, { minArea: 1, gap: 2 });
  L.markMoved(rg, A.m, B.m, L.dilate(A.m, W, H, 0), L.dilate(B.m, W, H, 0), W, H, 6, { minPts: 20 });
  const mv = rg.filter(g => g.moved);
  assert.ok(mv.length >= 1);
  mv.forEach(g => assert.deepEqual([g.moved.dx, g.moved.dy], [4, 3]));
  assert.ok(rg.some(g => !g.moved && g.x >= 40)); // 오른쪽 덩어리(10칸 아래로 이동 — 범위 6 밖)는 이동으로 설명 안 됨
});
test('블록별 정렬: 아래쪽 그림만 12 밀린 개정 도면 → 칸마다 따로 맞춰 차이가 사라짐', () => {
  const W = 120, H = 120;
  const A = blank(W, H); rect(A, 10, 10, 50, 40); rect(A, 20, 20, 30, 30, true); rect(A, 10, 70, 50, 100); rect(A, 60, 75, 70, 85, true);
  const B = blank(W, H); rect(B, 10, 10, 50, 40); rect(B, 20, 20, 30, 30, true); rect(B, 10, 82, 50, 112); rect(B, 60, 87, 70, 97, true);
  const d0 = L.diffMasks(A.m, B.m, W, H, 0);
  const ba = L.blockAlign(A.m, B.m, W, H, { tile: 60, R: 20, factor: 2, minPts: 4, penalty: 0.001, gain: 0.1 });
  const d1 = L.diffMasks(A.m, ba.warped, W, H, 0);
  assert.ok(d0.addedCount > 100);
  assert.equal(d1.addedCount + d1.removedCount, 0);
  assert.equal(ba.dy[0], 0); assert.equal(ba.dy[ba.cols], 12); // 위 칸은 그대로, 아래 칸은 12
});
test('글자 비교: 같은 자리 값 변경(350→450)·추가·삭제·이동', () => {
  const A = [{ str: '350', x: 100, y: 100, h: 10 }, { str: 'CN-01', x: 200, y: 50, h: 10 }, { str: '800', x: 300, y: 300, h: 10 }, { str: 'FUSE', x: 50, y: 400, h: 10 }, { str: '1', x: 10, y: 10, h: 8 }];
  const B = [{ str: '450', x: 102, y: 101, h: 10 }, { str: 'CN-01', x: 203, y: 52, h: 10 }, { str: '200', x: 500, y: 300, h: 10 }, { str: 'FUSE', x: 450, y: 380, h: 10 }, { str: '1', x: 12, y: 9, h: 8 }];
  const r = L.textDiff(A, B);
  const pick = t => r.list.filter(x => x.type === t).map(x => (x.a ? x.a.str : '') + '>' + (x.b ? x.b.str : ''));
  assert.deepEqual(pick('변경'), ['350>450']);
  assert.deepEqual(pick('추가'), ['>200']);
  assert.deepEqual(pick('삭제'), ['800>']);
  assert.deepEqual(pick('이동'), ['FUSE>FUSE']);
  assert.equal(r.same, 2);
});
test('BOM 양식 읽기: 제목줄(회사명 / 품번 / 품명)·머리행 2행·끝의 조회 일시 줄', () => {
  const aoa = [['회사명 : 가상회사 / 900000-00001 / HARNESS ASSY;TEST'], ['품목코드', '품목명', 'BOM버전', '규격', '단위', '수량', '생산공정', '위치', '적요'],
    ['CN-01', 'CONN', '', '2P', 'EA', 2, '', '', ''], ['WR-01', 'WIRE', '', '0.5SQ', 'M', 1.25, '', '', '메모'], ['', '', '', '', '', '', '', '', ''], ['2026/09/29  오전 11:08:58']];
  const p = L.parseBomSheet(aoa);
  assert.equal(p.key, '품목코드'); assert.equal(p.headerRow, 2); assert.equal(p.rows.length, 2);
  assert.equal(p.partNo, '900000-00001'); assert.equal(p.partName, 'HARNESS ASSY;TEST');
  assert.deepEqual(L.defaultCompareCols(p.headers, p.key), ['품목명', '규격', '단위', '수량']); // 적요·위치·생산공정·BOM버전은 뺌
});
test('대체 후보·ECN 변경자재 만들기', () => {
  const A = [{ 품목코드: 'OPT-ZC01', 품목명: 'CAP', 단위: 'EA', 수량: 6 }, { 품목코드: '9100123-2', 품목명: 'SHELL', 단위: '', 수량: 3 }, { 품목코드: 'W1', 품목명: 'WIRE', 단위: 'M', 수량: 1.2 }, { 품목코드: 'X9', 품목명: 'OLD', 단위: 'EA', 수량: 1 }];
  const B = [{ 품목코드: 'ZC01', 품목명: 'CAP', 단위: 'EA', 수량: 6 }, { 품목코드: '9100213-2', 품목명: 'SHELL', 단위: '', 수량: 3 }, { 품목코드: 'W1', 품목명: 'WIRE', 단위: 'M', 수량: 2.6 }, { 품목코드: 'N1', 품목명: 'NEW', 단위: 'EA', 수량: 4 }];
  const res = L.tableDiff(A, B, { key: '품목코드', cols: ['품목명', '단위', '수량'] });
  const reps = L.replacementCandidates(res).map(p => p.from.key + '>' + p.to.key);
  assert.deepEqual(reps.sort(), ['9100123-2>9100213-2', 'OPT-ZC01>ZC01']);
  const mats = L.materialsFromDiff(res, {});
  assert.deepEqual(mats.map(m => m.type + ':' + (m.beforeNo || '') + '>' + (m.afterNo || '')).sort(),
    ['대체:9100123-2>9100213-2', '대체:OPT-ZC01>ZC01', '삭제:X9>', '수량변경:W1>W1', '신규:>N1'].sort());
  const q = mats.find(m => m.type === '수량변경');
  assert.deepEqual([q.beforeQty, q.afterQty, L.materialDelta(q)], [1.2, 2.6, 1.4]);
  assert.equal(L.editDistance('9100123-2', '9100213-2'), 2);
});
test('설계변경통보서 9절 그림 자리: figure 옵션이면 64행부터 비우고 행 높이를 늘림', () => {
  const e = L.emptyEcn(); e.ecnNo = 'T-1';
  const r0 = L.ecnReport(e, TODAY);
  const r1 = L.ecnReport(e, TODAY, { figure: { heightPx: 520, caption: '비교 그림' } });
  assert.equal(r0.figure, null);
  assert.equal(r1.figure.row, 63);                    // 0부터 센 행 = 엑셀 64행
  assert.ok(String(r1.rows[62][0]).includes('비교 그림'));
  assert.equal(r1.rowsHpx[63], 40);                   // 520 / 13줄
  assert.ok(r1.merges.includes('A63:P63') && !r1.merges.includes('A63:P76'));
});
test('엑셀에 그림 넣기: 시트에 drawing 연결·그림 파일·형식 등록', () => {
  const XLSX = require('../vendor/xlsx.full.min.js');
  const XI = require('../js/xlsx-image.js');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'S1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['b']]), 'S2');
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const out = XI.addImages(XLSX, new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), [{ sheet: 2, png, col: 0, row: 3, width: 100, height: 50, name: '그림' }]);
  const z = XLSX.CFB.read(out, { type: 'array' });
  const txt = p => Buffer.from(XLSX.CFB.find(z, p).content).toString('utf8');
  assert.ok(txt('/xl/worksheets/sheet2.xml').includes('<drawing r:id="rIdImg1"/>'));
  assert.ok(!txt('/xl/worksheets/sheet1.xml').includes('<drawing'));
  assert.ok(txt('/xl/worksheets/_rels/sheet2.xml.rels').includes('../drawings/drawing1.xml'));
  assert.ok(txt('/xl/drawings/drawing1.xml').includes('<xdr:row>3</xdr:row>') && txt('/xl/drawings/drawing1.xml').includes('cx="952500"'));
  assert.ok(txt('/[Content_Types].xml').includes('Extension="png"') && txt('/[Content_Types].xml').includes('/xl/drawings/drawing1.xml'));
  assert.equal(XLSX.CFB.find(z, '/xl/media/image1.png').content.length, png.length);
  assert.deepEqual(XLSX.read(out, { type: 'array' }).SheetNames, ['S1', 'S2']); // 다시 읽힘
});

test('비교 범위 제한: 기준점 둘레 밖의 차이는 지움', () => {
  const W = 20, H = 10, a = new Uint8Array(W * H), b = new Uint8Array(W * H);
  b[2 * W + 2] = 1; b[5 * W + 15] = 1;
  const d = L.diffMasks(a, b, W, H, 0);
  const box = L.pointsBox([{ x: 12, y: 3 }, { x: 18, y: 8 }], 0);
  assert.deepEqual(box, { x0: 2, y0: -7, x1: 28, y1: 18 }); // 여백은 최소 10
  L.clipDiff(d, W, H, { x0: 10, y0: 0, x1: 19, y1: 9 });
  assert.equal(d.addedCount, 1); assert.equal(d.added[5 * W + 15], 1); assert.equal(d.added[2 * W + 2], 0);
});

console.log(passed + ' passed' + (process.exitCode ? ' — 실패 있음' : ''));
