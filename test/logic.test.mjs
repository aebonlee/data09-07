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

console.log(passed + ' passed' + (process.exitCode ? ' — 실패 있음' : ''));
