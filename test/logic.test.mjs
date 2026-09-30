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
// 멀리 옮겨진 블록(2026-09-29 저녁 「문의02」): 크기가 서로 다른 조각 4개로 된 블록(글자·기호 흉내)
function glyphs(b, x, y, skip) {
  const g = [[0, 0, 3, 3, true], [10, 0, 14, 2, true], [20, 0, 22, 5, true], [30, 0, 35, 5, false]];
  g.forEach((q, i) => { if (i !== skip) rect(b, x + q[0], y + q[1], x + q[2], y + q[3], q[4]); });
}
test('멀리 이동: 블록이 (60, 30) 옮겨지면 보라(이동)로 빼고, 새로 생긴 조각만 적색으로 남김', () => {
  const W = 120, H = 80;
  const A = blank(W, H); glyphs(A, 10, 10);
  const B = blank(W, H); glyphs(B, 70, 40); rect(B, 10, 60, 14, 64, true);   // 새 조각 5×5 = 25점
  const d = L.diffMasks(A.m, B.m, W, H, 0);
  const rg = L.diffRegions(d, W, H, { minArea: 1, gap: 12 });
  const before = { added: d.added.slice(), removed: d.removed.slice() };
  const mv = L.explainMoves(d, W, H, { tol: 0 });
  assert.deepEqual([mv.peaks[0].dx, mv.peaks[0].dy], [60, 30]);
  assert.equal(d.addedCount, 25);   // 남은 적색 = 새 조각뿐
  assert.equal(d.removedCount, 0);  // 파랑은 모두 이동으로 설명됨
  assert.equal(mv.pieces, 8);       // B 4조각 + A 4조각
  L.tagMovedRegions(rg, before, mv, W);
  const moved = rg.filter(g => g.moved);
  assert.equal(moved.length, 2);    // A 원래 자리(삭제) · B 옮긴 자리(추가)
  moved.forEach(g => { assert.deepEqual([g.moved.dx, g.moved.dy, g.moved.far], [60, 30, true]); });
  assert.ok(rg.some(g => g.type === '추가' && !g.moved && g.x === 10 && g.y === 60));
});
test('멀리 이동 아님: 같은 모양이 도면에 그대로 남아 있고 하나 더 생긴 것은 추가(적색)', () => {
  const W = 120, H = 80;
  const A = blank(W, H); glyphs(A, 10, 10);
  const B = blank(W, H); glyphs(B, 10, 10); glyphs(B, 70, 40);   // 기존 블록 그대로 + 같은 블록 새로 추가
  const d = L.diffMasks(A.m, B.m, W, H, 0);
  const n0 = d.addedCount;
  const mv = L.explainMoves(d, W, H, { tol: 0 });
  assert.equal(mv.count, 0);
  assert.equal(d.addedCount, n0);   // 사라진 선하고만 맞대므로 남아 있는 같은 모양과 짝이 되지 않음
});
test('옮긴 뒤 값까지 바뀜: 바뀐 조각은 적색·파랑으로 남고 영역은 「일부 이동」', () => {
  const W = 120, H = 80;
  const A = blank(W, H); glyphs(A, 10, 10);
  const B = blank(W, H); glyphs(B, 70, 40, 3); rect(B, 100, 55, 106, 56, true);   // 네 번째 조각(속 빈 6×6)을 빼고 조금 아래에 7×2 막대를 새로 그림
  const d = L.diffMasks(A.m, B.m, W, H, 0);
  const rg = L.diffRegions(d, W, H, { minArea: 1, gap: 12 });
  const before = { added: d.added.slice(), removed: d.removed.slice() };
  const mv = L.explainMoves(d, W, H, { tol: 0 });
  assert.equal(d.addedCount, 14);   // 새 막대 7×2
  assert.equal(d.removedCount, 20); // 사라진 속 빈 사각형 6×6 테두리 20점
  L.tagMovedRegions(rg, before, mv, W);
  const b = rg.find(g => g.type === '추가');
  assert.ok(!b.moved && b.movedShare > 0.6 && b.movedShare < 0.9);
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

test('회사 로고: js/brand-logo.js 사본이 img/logo.png 와 같음 · 비율대로 폭', () => {
  const fs = require('fs');
  const LG = require('../js/brand-logo.js');
  const png = fs.readFileSync(new URL('../img/logo.png', import.meta.url));
  assert.deepEqual(Buffer.from(LG.bytes()), png);          // 로고를 바꾸고 node scripts/make-logo-js.js 를 안 돌리면 여기서 실패
  assert.equal(LG.width, png.readUInt32BE(16));
  assert.equal(LG.height, png.readUInt32BE(20));
  assert.equal(LG.alt, '천일테크윈 로고');
  assert.equal(LG.widthFor(128), 155);
  assert.equal(LG.widthFor(56), 68);
  assert.ok(LG.dataUri.startsWith('data:image/png;base64,iVBOR'));
});
test('엑셀 그림: 같은 로고를 여러 시트에 넣으면 그림 파일은 하나 · 칸 안 여백 · 대체 글', () => {
  const XLSX = require('../vendor/xlsx.full.min.js');
  const XI = require('../js/xlsx-image.js');
  const LG = require('../js/brand-logo.js');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'S1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['b']]), 'S2');
  const fig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9]);
  const out = XI.addImages(XLSX, new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), [
    { sheet: 1, png: LG.bytes(), col: 0, row: 0, dx: 20, dy: 6, width: 82, height: 68, name: LG.alt, descr: LG.alt },
    { sheet: 2, png: LG.bytes(), col: 0, row: 0, width: 68, height: 56, name: LG.alt },
    { sheet: 2, png: fig, col: 0, row: 5, width: 10, height: 10, name: '그림' }]);
  const z = XLSX.CFB.read(out, { type: 'array' });
  const media = z.FullPaths.filter(p => /\/xl\/media\/.+\.png$/.test(p));
  assert.equal(media.length, 2);                            // 로고 1 + 그림 1
  const txt = p => Buffer.from(XLSX.CFB.find(z, p).content).toString('utf8');
  assert.ok(txt('/xl/drawings/_rels/drawing1.xml.rels').includes('../media/image1.png'));
  assert.ok(txt('/xl/drawings/_rels/drawing2.xml.rels').includes('../media/image1.png') && txt('/xl/drawings/_rels/drawing2.xml.rels').includes('../media/image2.png'));
  assert.ok(txt('/xl/drawings/drawing1.xml').includes('<xdr:colOff>190500</xdr:colOff>') && txt('/xl/drawings/drawing1.xml').includes('<xdr:rowOff>57150</xdr:rowOff>'));
  assert.ok(txt('/xl/drawings/drawing1.xml').includes('descr="천일테크윈 로고"'));
  assert.equal(Buffer.from(XLSX.CFB.find(z, '/xl/media/image1.png').content).length, LG.bytes().length);
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

console.log('제목란 읽기 · 파일명 규칙 (2026-09-29 저녁 문의04)');
// 실제 두산 제목란의 배치(라벨 작은 글자 · 값 큰 글자)를 본뜬 가상 값. 쪽 1000×700, 제목란은 오른쪽 아래.
const TB = [
  { str: 'NO.', x: 700, y: 560, w: 10, h: 5 }, { str: 'PART NO.', x: 725, y: 560, w: 25, h: 5 }, { str: 'PART NAME', x: 800, y: 560, w: 30, h: 5 },
  { str: 'MODEL', x: 700, y: 572, w: 18, h: 5 }, { str: 'NAME', x: 770, y: 570, w: 15, h: 5 },
  { str: 'HARNESS', x: 820, y: 580, w: 36, h: 10 }, { str: 'HX-77', x: 712, y: 585, w: 34, h: 10 },
  { str: 'AIRCON - TEST', x: 806, y: 602, w: 64, h: 10 },
  { str: 'Rev.', x: 740, y: 614, w: 10, h: 5 }, { str: '00', x: 752, y: 624, w: 14, h: 12 }, { str: 'A2', x: 712, y: 624, w: 15, h: 12 },
  { str: 'NO.', x: 870, y: 636, w: 9, h: 5 }, { str: '999999-00001', x: 887, y: 643, w: 67, h: 10 },
  { str: '26.06.30', x: 712, y: 646, w: 20, h: 5 }, { str: 'D', x: 700, y: 647, w: 4, h: 6 },
  { str: 'DOOSAN BOBCAT KOREA Co.,Ltd.', x: 770, y: 660, w: 160, h: 9 },
  { str: 'NO.', x: 60, y: 60, w: 9, h: 5 }, { str: 'W-001', x: 80, y: 60, w: 30, h: 5 }   // 도면 안 표 머리 — 제목란 영역 밖이라 쓰지 않음
];
test('제목란: 라벨 옆·아래 큰 글자를 값으로, 두 줄 품명은 이어 붙임, 날짜·고객사', () => {
  const f = L.titleBlockFields(TB, 1000, 700);
  assert.deepEqual(f, { partNo: '999999-00001', model: 'HX-77', partName: 'HARNESS AIRCON - TEST', rev: '00', dwgDate: '2026-06-30', customer: '두산밥캣코리아' });
});
test('제목란 우선 · 글자 라벨이 다음 칸 라벨을 잡은 값은 버림 · 파일명은 빈 칸만', () => {
  const text = 'NO. PART NO. PART NAME MATERIAL MODEL NAME Rev.\n2. APPLY THE RESIN TUBE AT ALL SPLICE AND RING TERMINAL';
  const r = L.extractFromPdf(text, TB, 1000, 700, '999999-00001_0001.pdf');
  assert.equal(r.fields.partNo, '999999-00001'); assert.equal(r.source.partNo, 'title');
  assert.equal(r.fields.rev, '00'); assert.equal(r.fields.usage, undefined);   // 주기 문장의 APPLY 는 사용처가 아님
  const old = L.extractFields(text, '', null).fields;
  assert.ok(old.partNo && old.partNo !== '999999-00001');                    // 예전 방식은 엉뚱한 값을 잡았음(되돌려 확인)
});
test('파일명 규칙: 품번·끝 영문 REV·YYMMDD 날짜·가운데 품명, _0001 일련번호는 버림', () => {
  assert.deepEqual(L.fileNameFields('999999-12345A MCV JOINT HARNESS - 260605.pdf'), { partNo: '999999-12345A', rev: 'A', dwgDate: '2026-06-05', partName: 'MCV JOINT HARNESS' });
  assert.deepEqual(L.fileNameFields('999999-12345_0001.pdf'), { partNo: '999999-12345' });
  assert.deepEqual(L.fileNameFields('HN-A0231_C.pdf'), {});
  const r = L.extractFromPdf('', [], 0, 0, '999999-12345A MCV JOINT HARNESS - 260605.pdf');   // 글자 정보 없는 PDF
  assert.deepEqual([r.fields.partNo, r.source.partNo, r.fields.rev, r.source.rev], ['999999-12345A', 'file', 'A', 'guess']);
  const o = L.extractFromPdf('', [], 0, 0, 'HN-A0231_C.pdf');                                 // 예전 예시 파일명 규칙 유지
  assert.deepEqual([o.fields.partNo, o.fields.rev], ['HN-A0231', 'C']);
});

console.log('하우징 → ASSY 자재 BOM (2026-09-29 저녁 문의03)');
const HM = [
  ['회사 하우징 마스터'],
  ['하우징 품번', '자재 품번', '자재명', '구분', '수량', '단위', '적용 전선(SQ)', '비고'],
  ['DT06-2S-CE06', 'LK-1', 'LOCK', 'LOCK', 1, 'EA', '', ''],
  ['', 'TM-S', '단자 소', '단자', 1, 'EA', '0.5~1.0', ''],
  ['', 'TM-L', '단자 대', '단자', 1, 'EA', '1.25-2.0 SQ', ''],
  ['CN-01', 'CAP-1', '캡', '', 2, 'EA', '', '']
];
test('마스터 읽기: 제목줄 건너 머리행 찾기, 병합 셀 이어쓰기, 단자는 회로당, 굵기 범위', () => {
  const p = L.parseHousingMaster(HM);
  assert.equal(p.headerRow, 2); assert.equal(p.rows.length, 4);
  assert.deepEqual(p.rows.map(r => [r.housing, r.item, r.basis]), [['DT06-2S-CE06', 'LK-1', '하우징당'], ['DT06-2S-CE06', 'TM-S', '회로당'], ['DT06-2S-CE06', 'TM-L', '회로당'], ['CN-01', 'CAP-1', '하우징당']]);
  assert.deepEqual([p.rows[1].csaMin, p.rows[1].csaMax, p.rows[2].csaMin, p.rows[2].csaMax], [0.5, 1, 1.25, 2]);
  assert.ok(L.parseHousingMaster([['품명', '수량']]).error);
});
test('하우징 찾기: 도면 글자에서 개수(하이픈 앞뒤 공백 허용), 없으면 주요 커넥터 칸', () => {
  const m = L.parseHousingMaster(HM).rows;
  const f = L.findHousings('ROTATING CW DEUTSCH DT06-2S-CE06 ... DT06 - 2S - CE06 ... XDT06-2S-CE06Y', 'CN-01, CN-99', m);
  assert.deepEqual(f, [{ housing: 'DT06-2S-CE06', count: 2, from: '도면 글자' }, { housing: 'CN-01', count: 1, from: '주요 커넥터 칸' }]);
  assert.equal(L.housingPins('DT06-2S-CE06', m), 2);   // 핀 수 열이 없으면 품번의 -2S
});
test('BOM 펼치기: 수량 = 마스터 × 회로 수 × 개수, 굵기 맞는 단자만, 굵기 모르면 확인 표시, 합치기', () => {
  const m = L.parseHousingMaster(HM).rows;
  let r = L.expandHousingBom([{ housing: 'DT06-2S-CE06', count: 3, circuits: 2, csa: 0.5, from: '도면 글자' }], m);
  assert.deepEqual(r.map(x => [x.품목코드, x.수량, x.출처]), [['DT06-2S-CE06', 3, '도면 글자'], ['LK-1', 3, 'ASSY 마스터 (DT06-2S-CE06)'], ['TM-S', 6, 'ASSY 마스터 (DT06-2S-CE06)']]);
  r = L.expandHousingBom([{ housing: 'DT06-2S-CE06', count: 1, circuits: 2 }], m);   // 굵기 모름 → 단자 둘 다 + 확인
  assert.deepEqual(r.filter(x => x.확인).map(x => x.품목코드), ['TM-S', 'TM-L']);
  r = L.expandHousingBom([{ housing: 'ZZ-1', count: 1 }], m);
  assert.equal(r.length, 1); assert.ok(/마스터에 없음/.test(r[0].확인));
  r = L.expandHousingBom([{ housing: 'CN-01', count: 1 }, { housing: 'CN-01', count: 2, from: '직접 입력' }], m, { merge: true });
  assert.deepEqual(r.map(x => [x.품목코드, x.수량]), [['CN-01', 3], ['CAP-1', 6]]);
  assert.deepEqual(L.sheetHousingBom(r, 'X')[1], ['품목코드', '품목명', '구분', '단위', '수량', '출처', '근거', '확인']);
});

// ── 2026-09-30 수강생 답 반영 ──
test('글자 정보 판정: 충분하면 있음, 비었거나 몇 개뿐이거나 깨졌으면 없음', () => {
  const many = ['PART NO.', 'HN-A0231', 'REV C', 'L=450', 'CN-0221', '품명', '350'].map(str => ({ str }));
  assert.equal(L.textLayerInfo(many).has, true);
  assert.equal(L.textLayerInfo([]).has, false);
  assert.ok(/선으로 그린/.test(L.textLayerInfo([]).reason));
  assert.equal(L.textLayerInfo(undefined).has, false);
  const few = L.textLayerInfo([{ str: '1/1' }, { str: 'Page 1' }, { str: ' ' }]);
  assert.equal(few.has, false); assert.equal(few.count, 2); assert.ok(/거의 없음/.test(few.reason));
  const broken = L.textLayerInfo(['', '��', '', '', '', '', 'A1', 'B2', 'C3', 'D4', 'E5'].map(str => ({ str })));
  assert.equal(broken.has, false); assert.ok(/깨져/.test(broken.reason));
  assert.equal(L.textLayerInfo(['기호', '—', '350', 'CN-01', 'OK', 'L=210']).has, true);   // 문자열 배열도 받음, 기호 조각 하나는 괜찮음
});
test('비교 방식: 둘 다 글자 정보 있으면 글자+선, 하나라도 없으면 선만(오류 없이 안내 문장)', () => {
  const T = ['PART NO.', 'HN-A0231', 'REV C', 'L=450', 'CN-0221'].map(str => ({ str }));
  let m = L.compareModeFor({ kind: 'pdf', text: T }, { kind: 'pdf', text: T });
  assert.equal(m.text, true); assert.ok(/함께/.test(m.message));
  m = L.compareModeFor({ kind: 'pdf', text: T }, { kind: 'pdf', text: [] });
  assert.equal(m.text, false); assert.equal(m.a.has, true); assert.equal(m.b.has, false);
  assert.ok(/^B 도면은 글자 정보 없음/.test(m.message)); assert.ok(/그림\(선\) 비교만/.test(m.message));
  m = L.compareModeFor({ kind: 'image', text: [] }, { kind: 'pdf', text: T });
  assert.ok(/^A 도면은 그림 파일/.test(m.message));
  m = L.compareModeFor(null, null);
  assert.equal(m.text, false);
});
test('BOM 적요 열은 늘 비교에서 뺌 — 기본값·직접 고른 열·결과 엑셀 모두', () => {
  const hs = ['품목코드', '품목명', 'BOM버전', '규격', '단위', '수량', '생산공정', '위치', '적요'];
  assert.deepEqual(L.defaultCompareCols(hs, '품목코드'), ['품목명', '규격', '단위', '수량']);
  assert.deepEqual(L.defaultCompareCols(['CODE', '메모칸', 'REMARK', '비 고'], 'CODE'), ['메모칸']);   // 힌트 열이 없어 전부 고를 때도 제외
  assert.equal(L.isExcludedBomCol('적요'), true); assert.equal(L.isExcludedBomCol('Remarks'), true); assert.equal(L.isExcludedBomCol('수량'), false);
  assert.deepEqual(L.bomCompareCols(['수량', '적요', '위치']), ['수량', '위치']);
  const A = [{ 품목코드: 'P-1', 수량: 1, 적요: '' }], B = [{ 품목코드: 'P-1', 수량: 1, 적요: '위해작성' }];
  const r = L.tableDiff(A, B, { key: '품목코드', cols: L.bomCompareCols(['수량', '적요']) });
  assert.equal(r.counts.동일, 1); assert.equal(r.counts.변경, 0);
  assert.ok(!L.sheetTableDiff(r, '품목코드')[0].some(h => /적요/.test(h)));
});


// ── 2026-09-30 오전 답 1~4 (하우징 마스터 실제 구조 · 쓰는 회로만 · CAV 표 굵기 · REV) ──
// 회사 자재 DB 내보내기와 같은 시트·열 이름의 가상 표본(값은 모두 지어낸 것 — 실제 자재 DB 값 아님)
console.log('회사 자재 DB 형식 · 쓰는 회로만 · CAV 표 (2026-09-30 오전 답)');
const H = (cols, ...rows) => [cols, ...rows];
const ERP = {
  '목차': [['#', '시트명']],
  'Item': H(['name', 'item_code', 'item_name', 'item_group'], ['T-S', 'T-S', 'T-S', 'X TML'], ['T-L', 'T-L', '단자 대', 'X TML'], ['LK-4', 'LK-4', 'LK-4', 'X LOCK']),
  'hsg_detail': H(['name', 'company', 'hsg_item', 'no_pins', 'lock_sn', 'lock_add_sn', 'cap_sn', 'hsg_match_sn', 'opt_sn', 'use_hsg'],
    ['A-HX-4P', '회사A', 'HX-4P', '4', 'LK-4', '', 'CP-1', 'HX-4M, HX-4M-1', 'OPX-1', '1'],
    ['B-HX-4P', '회사B', 'HX-4P', '4', 'LK-9', '', '', '', '', '1'],
    ['A-HY-3P', '회사A', 'HY-3P', '3', '', '', '', '', '', '1'],
    ['A-HZ-2P', '회사A', 'HZ-2P', '2', '', '', '', '', '', '0']),
  'hsg_pin_block': H(['name', 'idx', 'pin_range', 'block_type', 'sub_item', 'sub_remark', 'parent'],
    ['b1', '1', '0', 'TML', 'T-S', '', 'A-HX-4P'], ['b2', '2', '0', 'TML', 'T-L', '', 'A-HX-4P'],
    ['b3', '3', '0', 'SEAL', 'S-1', '', 'A-HX-4P'], ['b4', '4', '0', 'DUMMY', 'D-1', '', 'A-HX-4P'],
    ['b5', '1', '0', 'TML', 'T-S', '', 'B-HX-4P']),
  'hsg_pin': H(['name', 'pin_row', 'tml_gid', 'seal_gid', 'dummy_sn', 'parent'],
    ['p1', '1', '7', '', '', 'A-HY-3P'], ['p2', '2', '7', '', '', 'A-HY-3P'], ['p3', '3', '8', '', 'D-2', 'A-HY-3P']),
  'sub_group_id_item_link': H(['name', 'sub_group_item', 'parent'], ['l1', 'T-S', '7'], ['l2', 'T-P', '8']),
  'hsg_cover': H(['name', 'cover_item', 'parent'], ['c1', 'CV-4', 'A-HX-4P']),
  'hsg_etc_add_link_detail': H(['name', 'etc_add_item', 'qty', 'required', 'remark', 'parent'], ['e1', 'TB-1', '2', '1', '', 'A-HX-4P'], ['e2', 'OP-1', '1', '0', '도면 확인 후 기입', 'A-HX-4P']),
  'tml_detail': H(['name', 'company', 'tml_item', 'sq_min', 'sq_max'], ['x1', '회사A', 'T-S', '0.50', '1.00'], ['x2', '회사A', 'T-L', '1.25', '2.00'], ['x3', '회사A', 'T-P', '0.30', '0.50']),
  'seal_detail': H(['name', 'company', 'seal_item', 'sq_min', 'sq_max'], ['s1', '회사A', 'S-1', '0.50', '2.00']),
  'ga_sq_conversion': H(['name', 'ga', 'sq'], ['GA-18', '18', '0.9']),
  'sub_remark': H(['name', 'company', 'hsg_item', 'sub_item', 'sub_remark'], ['r1', '회사A', 'HX-4P', 'T-L', '큰 핀'])
};
test('회사 자재 DB: 시트 이름으로 알아보고, 회사별 하우징 → LOCK·커버·부가·단자(SQ 범위)·씰·더미 행', () => {
  assert.equal(L.isErpMasterBook(Object.keys(ERP)), true);
  assert.equal(L.isErpMasterBook(['Sheet1']), false);
  assert.deepEqual(L.erpCompanies(ERP), { '회사A': 3, '회사B': 1 });
  const p = L.parseErpMaster(ERP);                              // 하우징이 많은 회사A 가 기본
  assert.equal(p.company, '회사A'); assert.equal(p.stats.housings, 3); assert.equal(p.stats.otherCompany, 1);
  const hx = p.rows.filter(r => r.housing === 'HX-4P');
  assert.deepEqual(hx.map(r => [r.kind, r.item, r.basis, r.csaText]), [
    ['LOCK', 'LK-4', '하우징당', ''], ['캡', 'CP-1', '하우징당', ''], ['옵션', 'OPX-1', '하우징당', ''], ['커버', 'CV-4', '하우징당', ''], ['부가 자재', 'TB-1', '하우징당', ''], ['부가 자재', 'OP-1', '하우징당', ''],
    ['단자', 'T-S', '회로당', '0.5~1'], ['단자', 'T-L', '회로당', '1.25~2'], ['씰', 'S-1', '회로당', '0.5~2'], ['더미(빈 자리)', 'D-1', '빈 자리당', '']]);
  assert.equal(hx[5].optional, true); assert.equal(hx[4].qty, 2); assert.equal(hx[7].note, '큰 핀'); assert.equal(hx[7].name, '단자 대');
  assert.deepEqual(p.info['HX-4P'], { pins: 4, series: '', cap: 'CP-1', match: 'HX-4M, HX-4M-1', opt: 'OPX-1', use: true });
  // 블록이 없는 하우징은 hsg_pin + 단자 그룹 → 핀 범위로 묶음
  assert.deepEqual(p.rows.filter(r => r.housing === 'HY-3P').map(r => [r.kind, r.item, r.pinRange]), [['단자', 'T-S', '1~2'], ['단자', 'T-P', '3'], ['더미(빈 자리)', 'D-2', '3']]);
  assert.equal(p.info['HZ-2P'].use, false); assert.equal(p.stats.noChildren, 1);
  assert.deepEqual(p.gaSq, { '18': 0.9 });
  assert.equal(L.parseErpMaster(ERP, { company: '회사B' }).rows.length, 2);   // 회사B: LOCK + 단자(범위 없음)
});
test('BOM: 단자·씰은 쓰는 회로만, 굵기(SQ)별로 맞는 단자, 빈 자리는 더미, 선택 자재는 확인 표시', () => {
  const p = L.parseErpMaster(ERP), o = { info: p.info, gaSq: p.gaSq };
  const r = L.expandHousingBom([{ housing: 'HX-4P', count: 2, cavSpec: '1:0.5, 2:1.25, 4:18GA' }], p.rows, o);   // 4극 중 3자리 사용
  const q = Object.fromEntries(r.map(x => [x.품목코드, x.수량]));
  // 하우징 2곳 × (T-S: 0.5 · 18GA→0.9 = 2, T-L: 1.25 = 1, 씰 3, 더미 = 빈 자리 3번 1개)
  // 캡 · 옵션은 하우징당(2026-09-30 오후 답 ③), 짝 하우징은 고르지 않았으니 없음
  assert.deepEqual(q, { 'HX-4P': 2, 'LK-4': 2, 'CP-1': 2, 'OPX-1': 2, 'CV-4': 2, 'TB-1': 4, 'OP-1': 2, 'T-S': 4, 'T-L': 2, 'S-1': 6, 'D-1': 2 });
  assert.ok(/선택 자재/.test(r.find(x => x.품목코드 === 'OP-1').확인));
  assert.ok(/SQ 0.5×2, 0.9×2/.test(r.find(x => x.품목코드 === 'T-S').근거));
  // 굵기에 맞는 단자가 없으면 「맞는 단자 없음」 행 + 확인
  const n = L.expandHousingBom([{ housing: 'HX-4P', count: 1, cavSpec: '1:5' }], p.rows, o);
  assert.ok(n.some(x => x.품목코드 === '(맞는 단자 없음)' && /SQ 5 에 맞는 단자/.test(x.확인)));
  // 핀 범위가 나뉜 하우징: 1~2번 = T-S, 3번 = T-P / 3번을 안 쓰면 더미
  const y = L.expandHousingBom([{ housing: 'HY-3P', count: 1, cavSpec: '1:0.5, 3:0.3' }], p.rows, o);
  assert.deepEqual(y.map(x => [x.품목코드, x.수량]), [['HY-3P', 1], ['T-S', 1], ['T-P', 1]]);
  const y2 = L.expandHousingBom([{ housing: 'HY-3P', count: 1, cavSpec: '1:0.5, 2:0.5' }], p.rows, o);
  assert.deepEqual(y2.map(x => [x.품목코드, x.수량]), [['HY-3P', 1], ['T-S', 2], ['D-2', 1]]);
  // 사용 안 함 하우징은 확인 표시
  assert.ok(/사용 안 함|딸린 자재가 없습니다/.test(L.expandHousingBom([{ housing: 'HZ-2P', count: 1 }], p.rows, o)[0].확인));
});
test('도구 양식도 그대로: 적용 핀(CAV) 열 · 빈 자리당 기준을 읽음', () => {
  const p = L.parseHousingMaster([['하우징 품번', '자재 품번', '구분', '수량 기준', '적용 전선(SQ)', '핀 수', '적용 핀(CAV)'],
    ['CN-9', 'TA', '단자', '', '0.5~1.0', 3, '1~2'], ['', 'TB', '단자', '', '', '', '3'], ['', 'DM', '더미', '', '', '', '']]);
  assert.deepEqual(p.rows.map(r => [r.item, r.basis, r.pinRange, r.pins]), [['TA', '회로당', '1~2', 3], ['TB', '회로당', '3', null], ['DM', '빈 자리당', '', null]]);
  const r = L.expandHousingBom([{ housing: 'CN-9', count: 1, cavSpec: '2:0.75, 3' }], p.rows);
  assert.deepEqual(r.map(x => [x.품목코드, x.수량]), [['CN-9', 1], ['TA', 1], ['TB', 1], ['DM', 1]]);
});
test('굵기 범위가 겹치는 후보: 회로마다 범위가 가장 좁은 것 하나만', () => {
  const m = L.parseHousingMaster([['하우징 품번', '자재 품번', '구분', '적용 전선(SQ)'], ['CN-7', 'TA', '단자', '0.5~1.0'], ['', 'TW', '단자', '0.5~2.0']]).rows;
  const r = L.expandHousingBom([{ housing: 'CN-7', count: 1, cavSpec: '1:0.75, 2:1.5, 3:0.5' }], m);
  assert.deepEqual(r.map(x => [x.품목코드, x.수량]), [['CN-7', 1], ['TA', 2], ['TW', 1]]);
});
test('핀 범위 · 굵기 값 읽기', () => {
  assert.equal(L.pinRangeHas('0', 7), true); assert.equal(L.pinRangeHas('2~7, 10~15', 11), true); assert.equal(L.pinRangeHas('2~7, 10~15', 8), false);
  assert.equal(L.compactPins([5, 1, 2, 3, 9, 10]), '1~3, 5, 9~10');
  assert.equal(L.gaugeValue('18GA').sq, 0.85); assert.equal(L.gaugeValue('18GA', '', { '18': 0.9 }).sq, 0.9);
  assert.equal(L.gaugeValue('18', 'GA').awg, '18'); assert.equal(L.gaugeValue('0.5SQ', 'CSA').sq, 0.5); assert.equal(L.gaugeValue('1.25', 'CSA').sq, 1.25);
  assert.equal(L.gaugeValue(''), null);
  assert.deepEqual(L.parseCavSpec('1:0.5, 3~4:18GA, 6').map(c => c.cav + '=' + c.gauge), ['1=0.5', '3=18GA', '4=18GA', '6=']);
});
// CAV 표 가상 도면 조각 — 두산 도면처럼 커넥터 표 둘이 나란히, 아래에 전선표
function cell(str, x, y) { return { str, x, y, w: str.length * 5, h: 8 }; }
function cavTable(x0, name, hsg, rows) {
  const out = [cell('-' + name, x0, 40), cell(hsg, x0, 52), cell('MAKER', x0 + 70, 52),
    cell('PIN', x0, 64), cell('CORE', x0 + 20, 64), cell('GA', x0 + 52, 64), cell('COLOR', x0 + 76, 64)];
  rows.forEach((r, i) => { const y = 75 + i * 11; out.push(cell(r[0], x0 + 4, y)); if (r[1]) out.push(cell(r[1], x0 + 24, y), cell(r[2], x0 + 48, y), cell('BK', x0 + 80, y)); });
  return out;
}
const DWG = [
  ...cavTable(500, 'AIRCON', 'HX-4P', [['1', '13C', '18GA'], ['2', '9D', '16GA'], ['3'], ['4', '1C', '16GA']]),
  ...cavTable(620, 'COND', 'HX-4P', [['1', '13B', '18GA'], ['2', '35', '14GA'], ['3'], ['4', '1A', '14GA']]),
  cell('87', 624, 130), cell('2', 624, 141),                                   // 표 아래 다른 그림의 숫자(줄 간격이 벌어짐 — 표로 읽으면 안 됨)
  cell('NO', 40, 300), cell('CORE', 70, 300), cell('GA', 110, 300), cell('FROM', 160, 300), cell('TO', 220, 300),
  cell('1', 44, 311), cell('1A', 72, 311), cell('14GA', 106, 311), cell('S1', 165, 311), cell('COND(4)', 215, 311),
  cell('2', 44, 322), cell('13C', 72, 322), cell('18GA', 106, 322), cell('S2', 165, 322), cell('AIRCON(1)', 215, 322),
  cell('A', 18, 316)                                                           // 도면 테두리의 구역 글자
];
test('CAV 표 읽기: 나란한 표를 나누고, 커넥터 이름·하우징·빈 자리, 아래 다른 숫자는 안 읽음, 전선표', () => {
  const ts = L.parseWireTables(DWG);
  const cav = ts.filter(t => t.kind === 'cav');
  assert.deepEqual(cav.map(t => [t.name, t.housing, t.maker, t.rows.length]), [['AIRCON', 'HX-4P', 'MAKER', 4], ['COND', 'HX-4P', 'MAKER', 4]]);
  assert.deepEqual(cav[0].rows[2], { cav: '3', wire: '', gauge: '', color: '' });
  assert.deepEqual(cav[1].rows[3], { cav: '4', wire: '1A', gauge: '14GA', color: 'BK' });
  const wl = ts.filter(t => t.kind === 'wires');
  assert.equal(wl.length, 1); assert.deepEqual(wl[0].rows.map(r => [r.no, r.wire, r.to]), [['1', '1A', 'COND(4)'], ['2', '13C', 'AIRCON(1)']]);
  // CAV · WIRE · CSA 머리도 같은 방식
  const hd = [cell('CAV', 10, 10), cell('WIRE', 40, 10), cell('CSA', 80, 10), cell('1', 12, 21), cell('W01', 40, 21), cell('0.5', 82, 21), cell('2', 12, 32), cell('W02', 40, 32), cell('0.85', 82, 32)];
  assert.deepEqual(L.parseWireTables(hd)[0].rows.map(r => r.cav + ':' + r.gauge), ['1:0.5', '2:0.85']);
  assert.deepEqual(L.parseWireTables([cell('GA', 10, 10), cell('0.5', 12, 21)]), []);   // 굵기 머리 하나뿐이면 표가 아님
});
test('굵기 비교: 같은 전선이 다른 곳에서 다른 굵기면 알림, 전선표 FROM·TO 의 자리와 전선 번호 대조', () => {
  let gc = L.gaugeCheck(L.parseWireTables(DWG));
  assert.equal(gc.cavTables, 2); assert.equal(gc.wireTables, 1); assert.equal(gc.compared, 2); assert.deepEqual(gc.mismatches, []);
  const bad = DWG.map(t => t.str === '14GA' && t.x > 600 && t.y === 108 ? Object.assign({}, t, { str: '16GA' }) : t.str === '13C' && t.x < 100 ? Object.assign({}, t, { str: '13Z' }) : t);
  gc = L.gaugeCheck(L.parseWireTables(bad));
  assert.deepEqual(gc.mismatches.map(m => m.kind + ' ' + m.wire), ['전선 번호 다름 13Z', '굵기 다름 1A']);
  assert.deepEqual(gc.mismatches[1].entries.map(e => e.value), ['16GA', '14GA']);
});
test('CAV 표 → BOM: 표 하나 = 커넥터 하나, 표의 쓰는 핀·굵기로 단자, 마스터에 없는 품번은 비슷한 품번 안내', () => {
  const p = L.parseErpMaster(ERP);
  const tables = L.parseWireTables(DWG).concat([{ kind: 'cav', name: 'X', housing: 'HY', gaugeHead: 'GA', rows: [{ cav: '1', wire: 'a', gauge: '18' }] }]);
  const hc = L.housingsFromCavTables(tables, p.rows, p.info);
  assert.deepEqual(hc.found.map(f => [f.housing, f.count, f.from]), [['HX-4P', 2, 'CAV 표']]);
  assert.deepEqual(hc.missing, [{ name: 'X', housing: 'HY', near: ['HY-3P'], page: 1, skipped: false }]);
  assert.equal(hc.needPick.length, 1);
  const r = L.expandHousingBom(hc.found, p.rows, { info: p.info, gaSq: p.gaSq });
  const q = Object.fromEntries(r.map(x => [x.품목코드, x.수량]));
  // AIRCON 18·16·16GA, COND 18·14·14GA → T-S(0.5~1): 18GA(0.9) ×2, T-L(1.25~2): 16GA(1.25)×2 + 14GA(2)×2 = 4, 씰 6, 더미 2
  assert.deepEqual([q['HX-4P'], q['T-S'], q['T-L'], q['S-1'], q['D-1']], [2, 2, 4, 6, 2]);
});
test('REV: 품번 끝 영문 1자 = REV, 없으면 빈 칸(사용자 입력) · 사용처는 자동으로 채우지 않음', () => {
  assert.equal(L.revFromPartNo('999999-12345A'), 'A'); assert.equal(L.revFromPartNo('999999-12345'), ''); assert.equal(L.revFromPartNo('HN-A0231'), '');
  const t = [{ str: 'NO.', x: 700, y: 600, w: 12, h: 5 }, { str: '999999-00002B', x: 720, y: 600, w: 60, h: 9 }];
  let r = L.extractFromPdf('APPLY: MAIN', t, 1000, 700, 'x.pdf');
  assert.deepEqual([r.fields.partNo, r.fields.rev, r.source.rev, r.fields.usage], ['999999-00002B', 'B', 'guess', undefined]);
  r = L.extractFromPdf('', [], 0, 0, '999999-12345_0001.pdf');
  assert.equal(r.fields.rev, undefined); assert.ok(r.missing.indexOf('rev') >= 0 && r.missing.indexOf('usage') >= 0);
});

console.log('품번 선택창 · 캡/옵션/짝 하우징 · 전체 페이지 (2026-09-30 오후 답)');
test('꼬리 붙은 품번: 자동으로 합치지 않고 후보만(양쪽 방향), 선택창에서 고른 품번으로 BOM · 고르지 않음은 빠짐', () => {
  const keys = ['HY-3P', 'HY-3P-5', 'HY30', 'HYB', 'DT06'];
  assert.deepEqual(L.nearHousings('HY', keys), ['HY-3P', 'HY-3P-5']);          // HY30 · HYB 는 꼬리가 아님(구분자 없음)
  assert.deepEqual(L.nearHousings('DT06-2S', keys), ['DT06']);                // 도면 쪽에 꼬리가 더 붙은 경우
  assert.deepEqual(L.nearHousings('HY-3P', keys), ['HY-3P-5']);               // 똑같은 품번은 후보가 아님
  const p = L.parseErpMaster(ERP);
  const t = [{ kind: 'cav', name: 'X', housing: 'HY', page: 2, rows: [{ cav: '1', wire: 'a', gauge: '0.5' }, { cav: '2', wire: 'b', gauge: '0.5' }] }];
  // 고르기 전: 찾은 것 없음, 선택창에 나올 것 1
  let hc = L.housingsFromCavTables(t, p.rows, p.info);
  assert.deepEqual([hc.found.length, hc.needPick.length], [0, 1]);
  // 고른 뒤: 고른 품번으로, 도면 품번은 근거·확인에 남김
  hc = L.housingsFromCavTables(t, p.rows, p.info, { picks: { HY: 'HY-3P' } });
  assert.deepEqual(hc.found.map(f => [f.housing, f.count, f.drawn]), [['HY-3P', 1, ['HY']]]);
  const r = L.expandHousingBom(hc.found, p.rows, { info: p.info, gaSq: p.gaSq });
  assert.deepEqual(r.map(x => [x.품목코드, x.수량]), [['HY-3P', 1], ['T-S', 2], ['D-2', 1]]);
  assert.ok(/도면 품번\(HY\)과 다른 품번/.test(r[0].확인));
  // 「고르지 않음」: 선택창에 다시 나오지 않고 빠진 채로 안내
  hc = L.housingsFromCavTables(t, p.rows, p.info, { picks: { HY: '' } });
  assert.deepEqual([hc.found.length, hc.needPick.length, hc.missing[0].skipped], [0, 0, true]);
});
test('캡 · 옵션은 BOM 에, 짝 하우징은 후보 중 고른 것만 · 예전 마스터(캡 행 없음)도 하우징 정보로 채움', () => {
  const p = L.parseErpMaster(ERP), o = { info: p.info, gaSq: p.gaSq };
  assert.deepEqual(L.matingOptions('hx-4p', p.info), ['HX-4M', 'HX-4M-1']);
  let r = L.expandHousingBom([{ housing: 'HX-4P', count: 3, cavSpec: '1:0.5', matchPick: 'HX-4M-1' }], p.rows, o);
  const m = r.find(x => x.품목코드 === 'HX-4M-1');
  assert.deepEqual([m.구분, m.수량, m.확인], ['짝 하우징', 3, '']);
  assert.ok(!r.some(x => x.품목코드 === 'HX-4M'));
  // 후보가 아닌 값을 넣으면 확인 표시
  r = L.expandHousingBom([{ housing: 'HX-4P', count: 1, cavSpec: '1:0.5', matchPick: 'ZZ-1' }], p.rows, o);
  assert.ok(/후보가 아님/.test(r.find(x => x.품목코드 === 'ZZ-1').확인));
  // 캡 · 옵션 행을 뺀 예전 마스터 → info 로 채움(중복 없이)
  const old = p.rows.filter(x => x.kind !== '캡' && x.kind !== '옵션');
  r = L.expandHousingBom([{ housing: 'HX-4P', count: 2, cavSpec: '1:0.5' }], old, o);
  assert.deepEqual(r.filter(x => x.구분 === '캡' || x.구분 === '옵션').map(x => [x.품목코드, x.수량]), [['CP-1', 2], ['OPX-1', 2]]);
  r = L.expandHousingBom([{ housing: 'HX-4P', count: 2, cavSpec: '1:0.5' }], p.rows, o);
  assert.equal(r.filter(x => x.품목코드 === 'CP-1').length, 1);
});
test('전체 페이지: 쪽 쌍 만들기 · CAV 표 쪽 고르기 · 쪽별 요약 엑셀', () => {
  assert.deepEqual(L.pagePairs(3, 'all', 2, 'all'), [[1, 1], [2, 2], [3, null]]);
  assert.deepEqual(L.pagePairs(3, 'all', 2, 2), [[1, 2], [2, 2], [3, 2]]);
  assert.deepEqual(L.pagePairs(1, 1, 3, 'all'), [[1, 1], [1, 2], [1, 3]]);
  assert.deepEqual(L.pagePairs(3, 2, 3, 9), [[2, 3]]);                        // 없는 쪽 번호는 마지막 쪽으로
  const tb = [{ kind: 'cav', page: 1 }, { kind: 'cav', page: 3 }, { kind: 'wires', page: 3 }, { kind: 'cav' }];
  assert.deepEqual(L.cavPages(tb), [1, 3]);
  assert.equal(L.tablesOnPage(tb, 'all').length, 4); assert.equal(L.tablesOnPage(tb, 3).length, 2); assert.equal(L.tablesOnPage(tb, '1').length, 2);
  const rows = L.sheetPageSummary([{ pa: 1, pb: 1, add: 2, del: 1, moved: 0, text: { 변경: 1, 추가: 0, 삭제: 0, 이동: 3 }, align: '도곽' },
    { pa: 2, pb: 2, add: 0, del: 0, moved: 1, text: null, align: '' }, { pa: 3, pb: null }], 'A1', 'B1');
  assert.deepEqual(rows.slice(2).map(r => r[8]), ['차이 있음', '차이 없음', 'B 에 없는 쪽']);
  assert.equal(rows[2][5], 1);
});

console.log(passed + ' passed' + (process.exitCode ? ' — 실패 있음' : ''));
