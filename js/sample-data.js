/*
 * 예시 데이터 — 시연용 가상 값입니다. 실제 도면·고객사·ECN 이 아닙니다.
 * 품번·고객사·기종 표기는 수강생 UI 시안(교육용 익명화 샘플)의 모양을 따랐습니다.
 */
(function (root) {
  'use strict';
  function d(id, partNo, rev, partName, customer, model, usage, connectors, circuits, branches, wires, keywords, groupId, extra) {
    var o = {
      id: id, fileName: '예시데이터_' + partNo + '_' + rev + '.pdf', fileHash: '', partNo: partNo, rev: rev, partName: partName,
      customer: customer, model: model, usage: usage, regDate: '2026-09-' + (10 + parseInt(id.slice(-2), 10)),
      connectors: connectors, circuits: circuits, branches: branches, wires: wires, keywords: keywords,
      groupId: groupId, source: '예시 데이터', rawText: ''
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  var C_MAIN = 'CN-0118, CN-0120, CN-0131, CN-0140, CN-0155';
  var drawings = [
    d('DWG-0001', 'HN-A0198', 'B', 'MAIN 하네스', '고객사 A', 'X1', 'MAIN', C_MAIN, 36, 6, 'WR-0085, TB-0019', 'OPT-1, 코루게이트, TAPE', 'G-012', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-12 10:20' }),
    d('DWG-0002', 'HN-A0204', 'A', 'MAIN 하네스(옵션)', '고객사 A', 'X1-L', 'MAIN', 'CN-0118, CN-0120, CN-0131, CN-0162', 40, 7, 'WR-0085, TB-0019', 'OPT-2, 코루게이트', 'G-012', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-12 10:25', answerGroup: 'G-012' }),
    d('DWG-0003', 'HN-A0187', 'D', 'MAIN 하네스', '고객사 A', 'X2', 'MAIN', 'CN-0118, CN-0120, CN-0170, CN-0171', 30, 5, 'WR-0085, TB-0021', 'OPT-1, TAPE', 'G-009', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-13 09:00' }),
    d('DWG-0004', 'HN-A0189', 'A', 'MAIN 하네스(보조)', '고객사 A', 'X2', 'MAIN', 'CN-0118, CN-0170, CN-0171', 28, 5, 'WR-0085, TB-0021', 'TAPE', 'G-009', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-13 09:05', answerGroup: 'G-009' }),
    d('DWG-0005', 'HN-B0401', 'B', 'ENGINE 하네스', '고객사 B', 'Y2', 'ENGINE', 'CN-0300, CN-0301, CN-0310', 24, 4, 'WR-0125, TB-0030', '방수, GROMMET', 'G-015', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-14 14:00' }),
    d('DWG-0006', 'HN-B0405', 'A', 'ENGINE 하네스', '고객사 B', 'Y2', 'ENGINE', 'CN-0300, CN-0301, CN-0312', 26, 4, 'WR-0125, TB-0030', '방수', 'G-015', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-14 14:10', answerGroup: 'G-015' }),
    d('DWG-0007', 'HN-C0050', 'C', 'CABIN 하네스', '고객사 C', 'Z1', 'CABIN', 'CN-0500, CN-0501', 18, 3, 'WR-0050', 'SHIELD', 'G-020', { confirmedBy: '예시 담당자', confirmedAt: '2026-09-15 11:00' }),
    d('DWG-0008', 'HN-A0231', 'C', 'MAIN 하네스', '고객사 A', 'X1', 'MAIN', 'CN-0118, CN-0120, CN-0131, CN-0140, CN-0221', 38, 6, 'WR-0085, TB-0019', 'OPT-2, 코루게이트, TAPE', '', { analyzedAt: '2026-09-25 09:30', answerGroup: 'G-012',
      rawText: 'PART NO. HN-A0231 · REV C · TITLE: HARNESS ASSY-MAIN · MODEL X1 · CUST. 고객사 A · APPLY: ???' }),
    d('DWG-0009', 'HN-B0412', 'A', 'ENGINE 하네스', '고객사 B', 'Y2', '', 'CN-0300, CN-0310', 22, 4, 'WR-0125', '방수', '', { answerGroup: 'G-015' }),
    d('DWG-0010', 'HN-C0055', 'A', 'CABIN 하네스', '고객사 C', 'Z3', 'CABIN', 'CN-0520', 12, 2, 'WR-0050', '', '', { analyzedAt: '2026-09-25 09:40', answerGroup: '신규' }),
    d('DWG-0011', 'HN-B0377', 'A', 'CABIN 하네스', '고객사 B', 'Y1', 'CABIN', 'CN-0400, CN-0118', 20, 3, 'WR-0050', 'TAPE', '', {}),
    d('DWG-0012', 'HN-A0240', 'A', 'PANEL 하네스', '고객사 A', 'X2', 'PANEL', 'CN-0180, CN-0181', 14, 2, 'WR-0050', 'SHIELD', '', { analyzedAt: '2026-09-26 15:00' })
  ];
  var groups = [
    { id: 'G-009', name: '고객사 A X2 MAIN 계열', repDrawingId: 'DWG-0003', criteria: '고객사·기종·사용처 동일', confirmedBy: '예시 담당자', confirmedAt: '2026-09-13 09:00', memo: '' },
    { id: 'G-012', name: '고객사 A X1 MAIN 계열', repDrawingId: 'DWG-0001', criteria: '고객사·기종(파생 포함)·사용처 동일', confirmedBy: '예시 담당자', confirmedAt: '2026-09-12 10:20', memo: 'X1-L 옵션 도면 포함' },
    { id: 'G-015', name: '고객사 B Y2 ENGINE 계열', repDrawingId: 'DWG-0005', criteria: '고객사·기종·사용처 동일', confirmedBy: '예시 담당자', confirmedAt: '2026-09-14 14:00', memo: '' },
    { id: 'G-020', name: '고객사 C Z1 CABIN 계열', repDrawingId: 'DWG-0007', criteria: '고객사·기종·사용처 동일', confirmedBy: '예시 담당자', confirmedAt: '2026-09-15 11:00', memo: '' }
  ];
  function mat(type, location, beforeNo, beforeSpec, beforeQty, afterNo, afterSpec, afterQty, unit, stock, dept) {
    return { type: type, location: location, beforeNo: beforeNo, beforeSpec: beforeSpec, beforeQty: beforeQty, unit: unit,
      afterNo: afterNo, afterSpec: afterSpec, afterQty: afterQty, stock: stock, dept: dept, currentStock: '' };
  }
  function imp(item, applies, dept, due, done, action) {
    return { item: item, applies: applies, beforeDoc: '', afterDoc: '', action: action || '', dept: dept || '', person: '', due: due || '', done: done || '' };
  }
  var ecn1 = {
    id: 'ECN-0001', ecnNo: 'ECN-2026-014', status: '진행 중', docClass: '개발팀', writtenDate: '2026-09-24', changeKind: '정규', receivedDate: '2026-09-24', revNo: 0,
    model: 'X1', partNoAfter: 'HN-A0198', partNoBefore: 'HN-A0198', partName: 'MAIN 하네스', customer: '고객사 A', customerContact: '',
    reasonType: '고객 요청', revBefore: 'B', revAfter: 'C', requestSource: '고객사 A 설계팀', purpose: '방수 커넥터 적용 및 OPT-2 회로 추가',
    beforeText: '요청 내용 : 일반 커넥터 CN-0118 적용, 전선 0.85sq', afterText: '요청 사유 : 방수 커넥터 CN-0221 로 변경, 전선 1.25sq 로 대체, OPT-2 회로 추가',
    drawingBeforeId: 'DWG-0001', drawingAfterId: 'DWG-0001', groupId: 'G-012',
    applyDate: '', deliveryApply: '', applyCondition: '지정일 적용', applyLot: '', preApply: 'N', regularDate: '', stockPlan: '',
    receipts: ['생산', '생산기술', '품질경영', '영업', '생산관리', '구매·자재'].map(function (x) { return { dept: x, person: '', date: '', note: '' }; }),
    materials: [
      mat('신규', 'CN 방수부', '', '—', '', 'CN-0221', '방수 커넥터', 1, 'EA', '해당 없음', '구매'),
      mat('삭제', 'CN 방수부', 'CN-0118', '일반 커넥터', 1, '', '—', '', 'EA', '미정', '자재'),
      mat('대체', 'OPT-2 회로', 'WR-0085', '전선 0.85sq', 1, 'WR-0125', '전선 1.25sq', 1, 'EA', '소진 후 적용', '구매 · 생산'),
      mat('수량변경', '분기 3', 'TB-0019', '보호튜브', 2, 'TB-0019', '보호튜브', 3, 'M', '해당 없음', '생산')
    ],
    impacts: [
      imp('도면', '해당', '개발', '2026-10-02', '2026-09-26', 'REV C 도면 배포'),
      imp('BOM', '해당', '개발', '2026-10-02', '', 'BOM 개정'),
      imp('작업지시서', '해당', '생산기술', '2026-10-10', '', '작업지시서 개정'),
      imp('조립 JIG', '비해당'),
      imp('검사 JIG', ''),
      imp('구매 발주', '해당', '구매', '2026-10-06', '2026-09-27', 'CN-0221 신규 발주'),
      imp('구자재 재고 처리', '해당', '자재', '2026-10-08', '', 'CN-0118 재고 처리'),
      imp('초도품·품질 승인', ''),
      imp('포장·라벨·고객제출', '비해당')
    ],
    horizontal: [
      { drawingId: 'DWG-0002', partNo: 'HN-A0204', model: 'X1-L', customer: '고객사 A', relation: '동일 그룹 G-012', applies: '검토 중', result: '' },
      { drawingId: 'DWG-0008', partNo: 'HN-A0231', model: 'X1', customer: '고객사 A', relation: '유사 도면', applies: '적용', result: '신규 REV C 에 이미 반영' }
    ],
    remarks: '', detailMemo: '', meetingMemo: '', approval: { writer: '예시 작성자', reviewer: '', approver: '', receiver: '' },
    createdAt: '2026-09-24 09:00', completedAt: ''
  };
  var ecn2 = JSON.parse(JSON.stringify(ecn1));
  ecn2.id = 'ECN-0002'; ecn2.ecnNo = 'ECN-2026-009'; ecn2.status = '완료'; ecn2.writtenDate = '2026-09-05'; ecn2.receivedDate = '2026-09-03';
  ecn2.model = 'X2'; ecn2.partNoAfter = 'HN-A0187'; ecn2.partNoBefore = 'HN-A0187'; ecn2.revBefore = 'C'; ecn2.revAfter = 'D';
  ecn2.reasonType = '품질 개선'; ecn2.purpose = '보호튜브 규격 변경'; ecn2.drawingBeforeId = 'DWG-0003'; ecn2.drawingAfterId = 'DWG-0003'; ecn2.groupId = 'G-009';
  ecn2.beforeText = '보호튜브 TB-0019'; ecn2.afterText = '보호튜브 TB-0021 로 대체';
  ecn2.applyDate = '2026-09-15'; ecn2.applyCondition = '지정일 적용'; ecn2.stockPlan = '구자재 소진 후 적용';
  ecn2.materials = [mat('대체', '분기 2', 'TB-0019', '보호튜브', 2, 'TB-0021', '보호튜브(내열)', 2, 'M', '소진 후 적용', '구매')];
  ecn2.impacts = ecn2.impacts.map(function (i) {
    if (i.applies === '해당' || i.applies === '') return { item: i.item, applies: i.item === '검사 JIG' || i.item === '초도품·품질 승인' ? '비해당' : '해당', beforeDoc: '', afterDoc: '', action: '', dept: '개발', person: '', due: '2026-09-12', done: '2026-09-12' };
    return i;
  });
  ecn2.horizontal = [{ drawingId: 'DWG-0004', partNo: 'HN-A0189', model: 'X2', customer: '고객사 A', relation: '동일 그룹 G-009', applies: '미적용', result: '보호튜브 사용 안 함' }];
  ecn2.createdAt = '2026-09-05 10:00'; ecn2.completedAt = '2026-09-16 17:00';

  var sample = {
    _sample: true,
    drawings: drawings, groups: groups, ecns: [ecn1, ecn2],
    decisions: [
      { drawingId: 'DWG-0002', action: '기존 그룹 연결', groupId: 'G-012', prevGroupId: '', candidateId: 'DWG-0001', score: '', by: '예시 담당자', at: '2026-09-12 10:25', memo: 'OPT-2 회로 추가 외 구성 동일 — 동일 계열로 판단' }
    ],
    settings: null
  };
  var api = { build: function () { return JSON.parse(JSON.stringify(sample)); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HNSample = api;
})(typeof window !== 'undefined' ? window : this);
