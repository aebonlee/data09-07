/*
 * 하네스 유사도면 분류·ECN 관리 — 순수 로직 모듈 (화면·저장소와 무관)
 * 기준: docs/01_프로젝트_기획서.md v0.2
 *   - 유사도: 원문 3.6 가중치(제품군 25 · 사용처 20 · 부품 30 · 문자 15 · 형상 10)
 *   - ECN: docs/source/03_ECN_OUTPUT_설계변경통보서_양식.xlsx 의 항목과 자동 판정 수식
 * 브라우저에서는 window.HNLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 파일(file://)로 열면 브라우저가 module 스크립트를 막기 때문입니다.
 */
(function (root) {
  'use strict';

  // ── 코드값 ────────────────────────────────────────────────
  // 도면 필수 항목(원문 3.5 도면 데이터 중 추출 대상) — 비면 「추출 보정 필요」
  var REQUIRED_FIELDS = ['partNo', 'partName', 'rev', 'customer', 'model', 'usage'];
  var FIELD_LABEL = {
    drawingId: '도면 ID', fileName: '파일명', partNo: '품번', partName: '품명', rev: 'REV',
    customer: '고객사', model: '기종', usage: '사용처', regDate: '등록일',
    connectors: '주요 커넥터', circuits: '회로 수', branches: '분기 수', wires: '주요 전선·보호재',
    keywords: '구조 키워드', groupId: '그룹 ID', answerGroup: '담당자 정답 그룹', dwgDate: '도면 일자'
  };
  // 엑셀 가져오기(열 맞추기)에서 고를 수 있는 도면 항목
  var IMPORT_FIELDS = ['partNo', 'partName', 'rev', 'customer', 'model', 'usage', 'regDate',
    'connectors', 'circuits', 'branches', 'wires', 'keywords', 'fileName'];

  var WEIGHT_KEYS = ['family', 'usage', 'parts', 'text', 'shape'];
  var WEIGHT_LABEL = {
    family: '고객사·기종·제품군', usage: '사용처·품명', parts: '주요 부품·BOM 공용성',
    text: '도면 문자·키워드', shape: '간단한 형상 특징'
  };
  var WEIGHT_SHORT = { family: '제품군', usage: '사용처', parts: '부품', text: '문자', shape: '형상' };

  // 설계변경통보서 5절 — 변경 유형(양식 제목 행의 5종)
  var CHANGE_TYPES = ['신규', '삭제', '대체', '수량변경', '사양변경'];
  // 6절 — 영향도 검토 항목(양식 순서 그대로)
  var IMPACT_ITEMS = ['도면', 'BOM', '작업지시서', '조립 JIG', '검사 JIG', '구매 발주',
    '구자재 재고 처리', '초도품·품질 승인', '포장·라벨·고객제출'];
  // 4절 — 수신 부서
  var RECEIPT_DEPTS = ['생산', '생산기술', '품질경영', '영업', '생산관리', '구매·자재'];
  var ECN_STATUS = ['진행 중', '완료'];

  function defaultSettings() {
    return {
      weights: { family: 25, usage: 20, parts: 30, text: 15, shape: 10 }, // 원문 3.6
      threshold: 70,      // UI 시안 「기준점수 70」 — 기획서 10장 6번 확인 필요
      topN: 5,            // 원문 「상위 1~5건」
      scope: 'all',       // 비교 그룹 범위: all | sameCustomer
      approver: '',       // 확정자(승인 기록)
      usages: ['MAIN', 'CABIN', 'ENGINE', 'PANEL'], // 원문 예시 — 전체 목록 확인 필요(10장 4번)
      partPattern: '\\b[A-Z]{2,4}-?\\d{3,6}(?:-\\d+)?\\b', // 부품번호 모양(가정) — 실제 규칙 확인 필요
      keywordDict: ['방수', 'WATERPROOF', '코루게이트', 'CORRUGATE', 'TAPE', '테이프', 'TUBE', '튜브', 'SHIELD', 'GROMMET'] // (가정)
    };
  }

  function emptyDb() {
    return { drawings: [], groups: [], decisions: [], ecns: [], housingMaster: [], housingMasterName: '', housingInfo: {}, gaSq: {}, settings: defaultSettings() };
  }

  // ── 공통 ─────────────────────────────────────────────────
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function toDateStr(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
  }
  function toDateTimeStr(d) {
    return toDateStr(d) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }
  function norm(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' '); }
  function isBlank(v) { return v == null || String(v).trim() === ''; }
  function toNum(v) {
    if (v == null || v === '') return null;
    var n = Number(String(v).replace(/,/g, '').trim());
    return isFinite(n) ? n : null;
  }
  // 엑셀 N() 과 같게: 숫자가 아니면 0
  function N(v) { var n = toNum(v); return n == null ? 0 : n; }

  // "CN-0221, CN-0118 / WR-0085" → ['CN-0221','CN-0118','WR-0085']
  function splitList(s) {
    if (Array.isArray(s)) return s.map(norm).filter(Boolean);
    return String(s == null ? '' : s).split(/[,;/\n]+/).map(norm).filter(Boolean);
  }
  function uniq(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function tokens(s) {
    return uniq(String(s == null ? '' : s).toUpperCase().split(/[\s,;/()·\[\]]+/).filter(function (t) { return t.length >= 2; }));
  }
  function jaccard(a, b) {
    a = uniq(a); b = uniq(b);
    if (!a.length && !b.length) return null;
    var inter = a.filter(function (x) { return b.indexOf(x) >= 0; }).length;
    var union = uniq(a.concat(b)).length;
    return union ? inter / union : 0;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  // 파일 중복 확인용 해시(FNV-1a 32bit + 크기). 보안용이 아니라 같은 파일인지 가려내는 용도입니다.
  function fileHash(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return pad(h.toString(16), 8) + '-' + bytes.length;
  }

  function nextId(list, prefix, width, key) {
    key = key || 'id';
    var max = 0;
    list.forEach(function (x) {
      var m = String(x[key] || '').match(new RegExp('^' + prefix + '(\\d+)$'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + pad(max + 1, width);
  }

  // ── 정보 추출 (FR-02) ─────────────────────────────────────
  // 제목란 텍스트에서 라벨 뒤 값을 찾습니다. 라벨은 영문·국문 둘 다 봅니다(실제 제목란 양식 확인 필요 — 10장 3번).
  var LABELS = {
    partNo: ['PART\\s*NO\\.?', 'P\\/N', 'DWG\\s*NO\\.?', '품번', '도번'],
    rev: ['REV\\.?', 'REVISION', '개정'],
    partName: ['TITLE', 'DESCRIPTION', '품명'],
    model: ['MODEL', '기종', '차종'],
    customer: ['CUST(?:OMER)?\\.?', '고객사', '고객'],
    usage: ['APPLY', 'USAGE', '사용처'],
    circuits: ['CIRCUITS?', '회로\\s*수'],
    branches: ['BRANCH(?:ES)?', '분기\\s*수']
  };
  var ALL_LABELS = [].concat(LABELS.partNo, LABELS.rev, LABELS.partName, LABELS.model, LABELS.customer, LABELS.usage, LABELS.circuits, LABELS.branches).join('|');
  // 값은 구분자(· | ; , 줄바꿈) 또는 공백 뒤에 오는 다음 라벨 앞에서 끝납니다.
  var STOP = '(?=\\s*(?:·|\\||;|,|\\n|$)|\\s+(?:' + ALL_LABELS + ')(?![A-Z가-힣]))';

  // 여러 라벨 중 본문에서 가장 먼저 나오는 것을 씁니다.
  function findLabel(text, labels) {
    var best = null;
    for (var i = 0; i < labels.length; i++) {
      var re = new RegExp('(?:^|[^A-Z가-힣])' + labels[i] + '(?![A-Z가-힣])\\s*[:：]?\\s*([^\\n·|;,]+?)' + STOP, 'i');
      var m = re.exec(text);
      if (m && m[1] && m[1].trim() && !/^\?+$/.test(m[1].trim()) && (!best || m.index < best.index)) best = { index: m.index, value: m[1].trim() };
    }
    return best ? best.value : '';
  }

  function extractFields(text, fileName, settings) {
    settings = settings || defaultSettings();
    text = String(text || '');
    var out = {}, src = {};
    ['partNo', 'rev', 'partName', 'model', 'customer', 'usage'].forEach(function (k) {
      var v = findLabel(text, LABELS[k]);
      if (v) { out[k] = v; src[k] = 'auto'; }
    });
    // 파일명 규칙 보조: HN-A0231_C.pdf → 품번 HN-A0231, REV C (가정)
    var base = String(fileName || '').replace(/\.[^.]+$/, '');
    var fm = base.match(/^(.+?)[_ ]+(?:REV)?([A-Z0-9]{1,2})$/i);
    if (!out.partNo && fm) { out.partNo = fm[1]; src.partNo = 'file'; }
    if (!out.rev && fm) { out.rev = fm[2].toUpperCase(); src.rev = 'file'; }
    // 사용처: 라벨이 없으면 사용처 목록 낱말이 품명·본문에 있는지
    var usages = (settings.usages || []).map(norm);
    if (out.usage) {
      var u = norm(out.usage);
      var hit = usages.filter(function (x) { return u.indexOf(x) >= 0; })[0];
      out.usage = hit || u;
    } else {
      var hay = norm((out.partName || '') + ' ' + text);
      var found = usages.filter(function (x) { return new RegExp('(^|[^A-Z])' + x + '([^A-Z]|$)').test(hay); });
      if (found.length === 1) { out.usage = found[0]; src.usage = 'guess'; }
    }
    ['circuits', 'branches'].forEach(function (k) {
      var v = findLabel(text, LABELS[k]);
      var n = v ? toNum(v.replace(/[^\d.]/g, '')) : null;
      if (n != null) { out[k] = n; src[k] = 'auto'; }
    });
    // 부품번호 모양 낱말 → 주요 커넥터·자재 (품번 자신은 뺌)
    var parts = [];
    try {
      var re = new RegExp(settings.partPattern, 'g');
      var m;
      while ((m = re.exec(text.toUpperCase())) && parts.length < 60) {
        if (m[0] === '') { re.lastIndex++; continue; }
        parts.push(m[0]);
      }
    } catch (e) { /* 잘못된 패턴은 무시 */ }
    var own = norm(out.partNo);
    parts = uniq(parts).filter(function (p) { return p !== own; });
    if (parts.length) { out.connectors = parts.join(', '); src.connectors = 'auto'; }
    // 키워드: 옵션 코드(OPT-2 등) + 키워드 사전
    var kw = [];
    var up = text.toUpperCase();
    (up.match(/\bOPT-?\d+\b/g) || []).forEach(function (k) { kw.push(k); });
    (settings.keywordDict || []).forEach(function (k) {
      if (k && up.indexOf(String(k).toUpperCase()) >= 0) kw.push(norm(k));
    });
    kw = uniq(kw);
    if (kw.length) { out.keywords = kw.join(', '); src.keywords = 'auto'; }
    return { fields: out, source: src, missing: missingFields(out) };
  }

  function missingFields(d) {
    return REQUIRED_FIELDS.filter(function (k) { return isBlank(d[k]); });
  }

  // ── 중복 확인 (FR-01) ────────────────────────────────────
  function findDuplicates(drawings, cand) {
    var res = [];
    drawings.forEach(function (d) {
      if (d.id === cand.id) return;
      var why = [];
      if (cand.fileName && d.fileName && norm(d.fileName) === norm(cand.fileName)) why.push('파일명');
      if (cand.fileHash && d.fileHash && d.fileHash === cand.fileHash) why.push('해시');
      if (!isBlank(cand.partNo) && norm(d.partNo) === norm(cand.partNo) && norm(d.rev) === norm(cand.rev)) why.push('품번·REV');
      if (why.length) res.push({ id: d.id, partNo: d.partNo, rev: d.rev, reasons: why });
    });
    return res;
  }

  // ── 유사도 (FR-04, 원문 3.6) ─────────────────────────────
  // 기종 파생: 한쪽이 다른 쪽으로 시작하면(X1 / X1-L) 파생 기종으로 봅니다(가정).
  function sameOrDerived(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  // 각 항목의 비율(0~1)을 구하고 가중치를 곱합니다. 근거 문장을 함께 돌려줍니다.
  function itemRatios(a, b) {
    var r = {}, note = {};
    // 제품군: 고객사 절반, 기종(동일·파생) 절반
    var cust = !isBlank(a.customer) && norm(a.customer) === norm(b.customer);
    var mdl = sameOrDerived(a.model, b.model);
    r.family = (cust ? 0.5 : 0) + (mdl ? 0.5 : 0);
    note.family = (cust ? '고객사 동일' : '고객사 다름') + ' · ' + (mdl ? (norm(a.model) === norm(b.model) ? '기종 동일' : '파생 기종') : '기종 다름');
    // 사용처 60퍼센트 + 품명 낱말 겹침 40퍼센트
    var use = !isBlank(a.usage) && norm(a.usage) === norm(b.usage);
    var nm = jaccard(tokens(a.partName), tokens(b.partName));
    r.usage = (use ? 0.6 : 0) + 0.4 * (nm || 0);
    note.usage = (use ? '사용처 동일' : '사용처 다름') + ' · 품명 겹침 ' + Math.round((nm || 0) * 100) + '%';
    // 부품: 주요 커넥터·전선·보호재 목록 공용률(자카드)
    var pa = splitList(a.connectors).concat(splitList(a.wires));
    var pb = splitList(b.connectors).concat(splitList(b.wires));
    var pj = jaccard(pa, pb);
    r.parts = pj || 0;
    var common = uniq(pa).filter(function (x) { return pb.indexOf(x) >= 0; });
    note.parts = pj == null ? '부품 정보 없음' : '공용 ' + common.length + '종 / 합계 ' + uniq(pa.concat(pb)).length + '종';
    // 문자: 키워드 겹침
    var tj = jaccard(splitList(a.keywords), splitList(b.keywords));
    r.text = tj || 0;
    note.text = tj == null ? '키워드 없음' : '키워드 겹침 ' + Math.round(tj * 100) + '%';
    // 형상: 회로 수·분기 수가 가까운 정도의 평균
    var sh = [];
    [['circuits', '회로'], ['branches', '분기']].forEach(function (p) {
      var x = toNum(a[p[0]]), y = toNum(b[p[0]]);
      if (x == null || y == null) return;
      var mx = Math.max(Math.abs(x), Math.abs(y));
      sh.push(mx === 0 ? 1 : 1 - Math.abs(x - y) / mx);
    });
    r.shape = sh.length ? sh.reduce(function (s, v) { return s + v; }, 0) / sh.length : 0;
    note.shape = sh.length ? '회로·분기 근접 ' + Math.round(r.shape * 100) + '%' : '회로·분기 정보 없음';
    return { ratio: r, note: note };
  }

  function scorePair(a, b, weights) {
    weights = weights || defaultSettings().weights;
    var ir = itemRatios(a, b);
    var items = {}, total = 0;
    WEIGHT_KEYS.forEach(function (k) {
      var w = N(weights[k]);
      var s = ir.ratio[k] * w;
      items[k] = round1(s);
      total += s;
    });
    return { total: Math.round(total), items: items, notes: ir.note };
  }

  function weightSum(weights) {
    return WEIGHT_KEYS.reduce(function (s, k) { return s + N(weights[k]); }, 0);
  }

  // 공통점·차이점 (비교 패널)
  function compareDrawings(a, b) {
    var common = [], diff = [];
    function cmp(label, x, y) {
      if (isBlank(x) && isBlank(y)) return;
      if (norm(x) === norm(y)) common.push(label + ' ' + x);
      else diff.push(label + ' ' + (isBlank(x) ? '(없음)' : x) + ' / ' + (isBlank(y) ? '(없음)' : y));
    }
    cmp('고객사', a.customer, b.customer);
    cmp('기종', a.model, b.model);
    cmp('사용처', a.usage, b.usage);
    cmp('품명', a.partName, b.partName);
    var pa = splitList(a.connectors), pb = splitList(b.connectors);
    if (pa.length || pb.length) {
      var shared = pa.filter(function (x) { return pb.indexOf(x) >= 0; });
      var only = pa.filter(function (x) { return pb.indexOf(x) < 0; });
      var onlyB = pb.filter(function (x) { return pa.indexOf(x) < 0; });
      common.push('주요 커넥터 ' + uniq(pa).length + '종 중 ' + uniq(shared).length + '종 공용');
      if (only.length || onlyB.length) diff.push('커넥터 기준에만 ' + (only.join(', ') || '-') + ' / 후보에만 ' + (onlyB.join(', ') || '-'));
    }
    ['circuits', 'branches'].forEach(function (k) {
      var x = toNum(a[k]), y = toNum(b[k]);
      if (x == null || y == null) return;
      var lab = k === 'circuits' ? '회로 수' : '분기 수';
      if (x === y) common.push(lab + ' ' + x);
      else diff.push(lab + ' ' + x + ' / ' + y + ' (' + (x - y > 0 ? '+' : '') + (x - y) + ')');
    });
    var ka = splitList(a.keywords), kb = splitList(b.keywords);
    var kOnly = ka.filter(function (x) { return kb.indexOf(x) < 0; });
    if (kOnly.length) diff.push('기준 도면에만 있는 키워드 ' + kOnly.join(', '));
    return { common: common, diff: diff };
  }

  // 후보 목록: 제외 목록·비교 범위를 반영해 총점 내림차순 상위 N건
  function rankCandidates(target, drawings, settings) {
    settings = settings || defaultSettings();
    var excluded = target.excluded || [];
    var list = drawings.filter(function (d) {
      if (d.id === target.id) return false;
      if (excluded.indexOf(d.id) >= 0) return false;
      if (settings.scope === 'sameCustomer' && norm(d.customer) !== norm(target.customer)) return false;
      return true;
    }).map(function (d) {
      var s = scorePair(target, d, settings.weights);
      return { id: d.id, partNo: d.partNo, rev: d.rev, groupId: d.groupId || '', total: s.total, items: s.items, notes: s.notes };
    });
    list.sort(function (x, y) { return y.total - x.total || String(x.partNo).localeCompare(String(y.partNo)); });
    var n = Math.max(1, Math.min(5, N(settings.topN) || 5));
    list = list.slice(0, n);
    list.forEach(function (c, i) { c.rank = i + 1; });
    return list;
  }

  // 임계값 판정(원문 6.2): 기준점수 이상인 후보 중 그룹이 있는 가장 높은 후보의 그룹 → 기존 그룹 후보
  function classify(cands, threshold) {
    var top = cands[0];
    if (!top) return { kind: 'new', groupId: '', score: null, text: '비교할 도면 없음 · 신규 그룹 후보' };
    var g = cands.filter(function (c) { return c.total >= N(threshold) && c.groupId; })[0];
    if (g) {
      return { kind: 'existing', groupId: g.groupId, score: g.total, text: '기존 그룹 후보 ' + g.groupId + ' (' + g.rank + '순위 ' + g.total + '점)' };
    }
    if (top.total >= N(threshold)) {
      return { kind: 'pair', groupId: '', score: top.total, text: '기준점수 이상이나 1순위 도면이 미분류 · 함께 신규 그룹 후보' };
    }
    return { kind: 'new', groupId: '', score: top.total, text: '기준점수 미만 · 신규 그룹 후보' };
  }

  // ── 도면 상태 ─────────────────────────────────────────────
  // 추출 보정 필요 → 미분류(분석 전) → 검토대기(분석 완료·승인 전) → 그룹 확정
  function drawingStatus(d) {
    if (d.groupId) return '그룹 확정';
    if (missingFields(d).length) return '추출 보정 필요';
    if (d.analyzedAt) return '검토대기';
    return '미분류';
  }

  // ── 그룹 확정 (FR-05) ────────────────────────────────────
  function confirmGroup(db, drawingId, opt, now) {
    var d = findBy(db.drawings, drawingId);
    if (!d) throw new Error('도면을 찾을 수 없습니다.');
    if (isBlank(opt.by)) throw new Error('확정자를 입력하세요. 설정에서 이름을 저장해 두면 자동으로 들어갑니다.');
    var at = toDateTimeStr(now || new Date());
    var gid;
    if (opt.action === 'link') {
      var g = findBy(db.groups, opt.groupId);
      if (!g) throw new Error('연결할 그룹이 없습니다.');
      gid = g.id;
    } else if (opt.action === 'new') {
      if (isBlank(opt.name)) throw new Error('신규 그룹명을 입력하세요.');
      gid = nextId(db.groups, 'G-', 3);
      db.groups.push({
        id: gid, name: String(opt.name).trim(), repDrawingId: d.id, criteria: opt.criteria || '',
        confirmedBy: opt.by, confirmedAt: at, memo: opt.memo || ''
      });
      // 기준점수 이상 미분류 후보를 함께 묶는 경우
      (opt.withIds || []).forEach(function (id) {
        var o = findBy(db.drawings, id);
        if (o && !o.groupId) o.groupId = gid;
      });
    } else {
      throw new Error('처리 방법을 고르세요.');
    }
    var prev = d.groupId || '';
    d.groupId = gid;
    d.confirmedBy = opt.by;
    d.confirmedAt = at;
    db.decisions.push({
      drawingId: d.id, action: opt.action === 'link' ? '기존 그룹 연결' : '신규 그룹 생성',
      groupId: gid, prevGroupId: prev, candidateId: opt.candidateId || '', score: opt.score == null ? '' : opt.score,
      by: opt.by, at: at, memo: opt.memo || ''
    });
    return gid;
  }

  function excludeCandidate(db, drawingId, candId, by, now) {
    var d = findBy(db.drawings, drawingId);
    if (!d) return;
    d.excluded = uniq((d.excluded || []).concat([candId]));
    db.decisions.push({ drawingId: d.id, action: '후보 제외', groupId: '', prevGroupId: d.groupId || '', candidateId: candId, score: '', by: by || '', at: toDateTimeStr(now || new Date()), memo: '' });
  }

  function findBy(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // ── 검색 (FR-06) ─────────────────────────────────────────
  function searchDrawings(drawings, q) {
    q = q || {};
    function has(v, s) { return isBlank(s) || norm(v).indexOf(norm(s)) >= 0; }
    return drawings.filter(function (d) {
      if (!has(d.partNo, q.partNo) || !has(d.customer, q.customer) || !has(d.model, q.model) || !has(d.usage, q.usage)) return false;
      if (q.groupId && d.groupId !== q.groupId) return false;
      if (q.status === '그룹 미확정') { if (d.groupId) return false; }
      else if (q.status && drawingStatus(d) !== q.status) return false;
      if (!isBlank(q.text)) {
        var all = [d.id, d.partNo, d.partName, d.rev, d.customer, d.model, d.usage, d.fileName, d.keywords, d.connectors, d.groupId].join(' ');
        if (norm(all).indexOf(norm(q.text)) < 0) return false;
      }
      return true;
    });
  }

  function searchEcns(ecns, text) {
    if (isBlank(text)) return ecns.slice();
    return ecns.filter(function (e) {
      var all = [e.ecnNo, e.customer, e.model, e.partNoAfter, e.partNoBefore, e.partName, e.purpose, e.groupId].join(' ');
      (e.materials || []).forEach(function (m) { all += ' ' + m.beforeNo + ' ' + m.afterNo; });
      return norm(all).indexOf(norm(text)) >= 0;
    });
  }

  // ── ECN · 설계변경통보서 ─────────────────────────────────
  function emptyEcn() {
    return {
      id: '', ecnNo: '', status: '진행 중', docClass: '개발팀', writtenDate: '', changeKind: '', receivedDate: '', revNo: 0,
      model: '', partNoAfter: '', partNoBefore: '', partName: '', customer: '', customerContact: '',
      reasonType: '', revBefore: '', revAfter: '', requestSource: '', purpose: '',
      beforeText: '', afterText: '',
      drawingBeforeId: '', drawingAfterId: '', groupId: '',
      applyDate: '', deliveryApply: '', applyCondition: '', applyLot: '', preApply: '', regularDate: '', stockPlan: '',
      receipts: RECEIPT_DEPTS.map(function (d) { return { dept: d, person: '', date: '', note: '' }; }),
      materials: [],
      impacts: IMPACT_ITEMS.map(function (it) { return { item: it, applies: '', beforeDoc: '', afterDoc: '', action: '', dept: '', person: '', due: '', done: '' }; }),
      horizontal: [],
      remarks: '', detailMemo: '', meetingMemo: '',
      approval: { writer: '', reviewer: '', approver: '', receiver: '' },
      createdAt: '', completedAt: ''
    };
  }

  // 5절 증감(자동): 신규·삭제·수량변경은 변경 후 − 변경 전, 그 밖은 "-"
  function materialDelta(m) {
    if (isBlank(m.type)) return '';
    // 소수 수량(전선 길이 1.2 → 2.6 M)의 뺄셈 오차(1.4000000000000001)를 없애려고 소수 6자리에서 반올림합니다
    if (m.type === '수량변경' || m.type === '신규' || m.type === '삭제') return Math.round((N(m.afterQty) - N(m.beforeQty)) * 1e6) / 1e6;
    return '-';
  }
  function typeCounts(materials) {
    var c = {};
    CHANGE_TYPES.forEach(function (t) { c[t] = 0; });
    (materials || []).forEach(function (m) { if (c[m.type] != null) c[m.type]++; });
    return c;
  }
  function typeCountText(materials) {
    var c = typeCounts(materials);
    return CHANGE_TYPES.map(function (t) { return t + ' ' + c[t]; }).join('  /  ');
  }
  function filledMaterials(materials) {
    return (materials || []).filter(function (m) { return !isBlank(m.type); });
  }
  function stockUndecided(materials) {
    return filledMaterials(materials).filter(function (m) { return isBlank(m.stock) || String(m.stock).trim() === '미정'; }).length;
  }

  // 6절 상태(자동) — 양식 수식과 같은 순서
  function impactStatus(it, today) {
    if (isBlank(it.applies)) return '미검토';
    if (it.applies === '비해당') return '-';
    if (!isBlank(it.done)) return '완료';
    if (isBlank(it.due)) return '일정 미정';
    if (String(it.due) < toDateStr(today || new Date())) return '지연';
    return '진행 중';
  }

  // 8절 종결 확인(자동 판정) + 원문 6.2 「담당부서 미정 시 완료 제한」
  function closureCheck(e) {
    var r = {};
    var miss = [];
    if (isBlank(e.applyDate)) miss.push('제품적용일');
    if (isBlank(e.applyCondition)) miss.push('적용조건');
    if (isBlank(e.stockPlan)) miss.push('재고처리방안');
    r.apply = miss.length ? '누락: ' + miss.join(' ') : '확인';
    var mats = filledMaterials(e.materials);
    var und = stockUndecided(e.materials);
    r.materials = !mats.length ? '변경자재 없음' : (und ? '미정 ' + und + '건' : '확인');
    var noDept = mats.filter(function (m) { return isBlank(m.dept); }).length;
    r.materialDept = noDept ? '담당부서 미정 ' + noDept + '건' : '확인';
    var imps = e.impacts || [];
    var blank = imps.filter(function (i) { return isBlank(i.applies); }).length;
    var notDone = imps.filter(function (i) { return i.applies === '해당' && isBlank(i.done); }).length;
    r.impacts = blank ? '미검토 ' + blank + '건' : (notDone ? '미완료 ' + notDone + '건' : '확인');
    var hz = (e.horizontal || []).filter(function (h) { return !isBlank(h.partNo); });
    var reviewing = hz.filter(function (h) { return isBlank(h.applies) || h.applies === '검토 중'; }).length;
    r.horizontal = !hz.length ? '대상 없음' : (reviewing ? '검토 중 ' + reviewing + '건' : '확인');
    r.canClose = r.apply === '확인' && (r.materials === '확인' || r.materials === '변경자재 없음') &&
      r.materialDept === '확인' && r.impacts === '확인' && (r.horizontal === '확인' || r.horizontal === '대상 없음');
    r.verdict = r.canClose ? '종결 가능' : '종결 불가';
    r.problems = [];
    if (r.apply !== '확인') r.problems.push('적용 시점·재고 처리 — ' + r.apply);
    if (r.materials !== '확인' && r.materials !== '변경자재 없음') r.problems.push('변경자재 재고처리 ' + r.materials);
    if (r.materialDept !== '확인') r.problems.push('변경자재 ' + r.materialDept);
    if (r.impacts !== '확인') r.problems.push('영향도 검토·부서 조치 ' + r.impacts);
    if (r.horizontal !== '확인' && r.horizontal !== '대상 없음') r.problems.push('수평전개 ' + r.horizontal);
    return r;
  }

  function completeEcn(e, now) {
    var c = closureCheck(e);
    if (!c.canClose) throw new Error('완료 처리 제한 · ' + c.problems.join(' / '));
    e.status = '완료';
    e.completedAt = toDateTimeStr(now || new Date());
    return e;
  }

  // 지연 ECN: 진행 중이고 적용일이 지났거나, 해당 영향 항목 중 「지연」이 있음
  function ecnDelayed(e, today) {
    if (e.status === '완료') return false;
    var t = toDateStr(today || new Date());
    if (!isBlank(e.applyDate) && String(e.applyDate) < t) return true;
    return (e.impacts || []).some(function (i) { return impactStatus(i, today) === '지연'; });
  }

  // 수평전개 후보: 대상 도면과 같은 그룹 + 유사 후보(기준점수 이상)
  function horizontalCandidates(db, e) {
    var target = findBy(db.drawings, e.drawingAfterId) || findBy(db.drawings, e.drawingBeforeId);
    if (!target) return [];
    var skip = [e.drawingBeforeId, e.drawingAfterId];
    var out = [];
    var gid = e.groupId || target.groupId;
    db.drawings.forEach(function (d) {
      if (skip.indexOf(d.id) >= 0) return;
      if (gid && d.groupId === gid) out.push({ drawingId: d.id, partNo: d.partNo, model: d.model, customer: d.customer, relation: '동일 그룹 ' + gid });
    });
    rankCandidates(target, db.drawings, db.settings).forEach(function (c) {
      if (skip.indexOf(c.id) >= 0 || c.total < N(db.settings.threshold)) return;
      if (out.some(function (o) { return o.drawingId === c.id; })) return;
      var d = findBy(db.drawings, c.id);
      out.push({ drawingId: d.id, partNo: d.partNo, model: d.model, customer: d.customer, relation: '유사 도면 ' + c.total + '점' });
    });
    return out;
  }

  // ── 유사 후보 적중 검증 (양식 14, 원문 성과지표) ─────────────
  // 담당자 정답 그룹이 상위 3개 후보의 그룹 안에 있으면 적중.
  // 정답이 「신규」면 1순위가 기준점수 미만일 때 적중(가정).
  function hitCheck(db, topK) {
    topK = topK || 3;
    var rows = [];
    db.drawings.forEach(function (d) {
      if (isBlank(d.answerGroup)) return;
      // 후보의 그룹은 다른 도면에 확정된 그룹입니다(자기 자신은 후보에서 빠짐).
      var cands = rankCandidates(d, db.drawings, db.settings).slice(0, topK);
      var hit = false, hitRank = '';
      if (d.answerGroup === '신규') {
        hit = !cands.length || cands[0].total < N(db.settings.threshold);
        hitRank = hit ? '신규' : '';
      } else {
        for (var i = 0; i < cands.length; i++) {
          if (cands[i].groupId === d.answerGroup) { hit = true; hitRank = i + 1; break; }
        }
      }
      rows.push({ drawingId: d.id, partNo: d.partNo, rev: d.rev, answer: d.answerGroup, cands: cands, hit: hit, hitRank: hitRank });
    });
    var hits = rows.filter(function (r) { return r.hit; }).length;
    return { rows: rows, total: rows.length, hits: hits, rate: rows.length ? Math.round(hits / rows.length * 1000) / 10 : null };
  }

  // ── 대시보드 ─────────────────────────────────────────────
  function dashboard(db, today) {
    var st = { total: db.drawings.length, unclassified: 0, review: 0, fix: 0, ecnOpen: 0, ecnMissing: 0, ecnDelayed: 0 };
    db.drawings.forEach(function (d) {
      var s = drawingStatus(d);
      if (s !== '그룹 확정') st.unclassified++;
      if (s === '검토대기') st.review++;
      if (s === '추출 보정 필요') st.fix++;
    });
    db.ecns.forEach(function (e) {
      if (e.status === '완료') return;
      st.ecnOpen++;
      if (!closureCheck(e).canClose) st.ecnMissing++;
      if (ecnDelayed(e, today)) st.ecnDelayed++;
    });
    return st;
  }

  // ── 엑셀 가져오기: 열 맞추기 ──────────────────────────────
  // 머리행 이름으로 기본 대응을 추측합니다(사용자가 화면에서 고칠 수 있음).
  var GUESS = {
    partNo: ['품번', 'PART NO', 'PARTNO', 'P/N', '도번', '도면번호'],
    partName: ['품명', 'TITLE', 'DESCRIPTION', '명칭'],
    rev: ['REV', '개정', 'REVISION'],
    customer: ['고객사', '고객', 'CUSTOMER', 'CUST'],
    model: ['기종', '차종', 'MODEL'],
    usage: ['사용처', 'USAGE', 'APPLY', '용도'],
    regDate: ['등록일', '작성일', 'DATE'],
    connectors: ['커넥터', 'CONNECTOR', '주요 부품'],
    circuits: ['회로', 'CIRCUIT'],
    branches: ['분기', 'BRANCH'],
    wires: ['전선', '보호재', 'WIRE'],
    keywords: ['키워드', 'KEYWORD', '주기'],
    fileName: ['파일명', 'FILE']
  };
  function guessMapping(headers) {
    var map = {};
    IMPORT_FIELDS.forEach(function (f) {
      var h = headers.filter(function (hd) {
        var H = norm(hd).replace(/\s|\./g, '');
        return GUESS[f].some(function (g) { return H.indexOf(norm(g).replace(/\s|\./g, '')) >= 0; });
      })[0];
      map[f] = h || '';
    });
    // 같은 머리행이 두 항목에 잡히면 앞 항목만 남김
    var used = {};
    IMPORT_FIELDS.forEach(function (f) { if (map[f] && used[map[f]]) map[f] = ''; else if (map[f]) used[map[f]] = true; });
    return map;
  }

  function importRows(db, rows, mapping, now) {
    var added = 0, skipped = [];
    rows.forEach(function (row, i) {
      var d = { id: '' };
      IMPORT_FIELDS.forEach(function (f) {
        if (!mapping[f]) return;
        var v = row[mapping[f]];
        if (v instanceof Date) v = toDateStr(v);
        d[f] = v == null ? '' : String(v).trim();
      });
      if (isBlank(d.partNo)) { skipped.push({ row: i + 2, reason: '품번 없음' }); return; }
      var dup = findDuplicates(db.drawings, d);
      if (dup.length) { skipped.push({ row: i + 2, reason: '중복(' + dup[0].reasons.join('·') + ') ' + dup[0].id }); return; }
      d.id = nextId(db.drawings, 'DWG-', 4);
      d.regDate = d.regDate || toDateStr(now || new Date());
      d.source = '엑셀 가져오기';
      ['circuits', 'branches'].forEach(function (k) { if (d[k] != null) d[k] = toNum(d[k]) == null ? '' : toNum(d[k]); });
      db.drawings.push(d);
      added++;
    });
    return { added: added, skipped: skipped };
  }

  // ── 엑셀 출력용 표 (양식 3·4·5·6·14 + 부서별 조치사항) ────────
  function groupName(db, gid) { var g = findBy(db.groups, gid); return g ? g.name : ''; }

  function sheetSimilarity(db, ids) {
    var head = ['기준 도면 ID', '기준 품번', '기준 REV', '추천순위', '비교 도면 ID', '비교 품번', '비교 REV', '비교 도면 그룹',
      '총점', '제품군 점수', '사용처 점수', '부품 점수', '문자 점수', '형상 점수', '판정', '공통점', '차이점'];
    var rows = [head];
    (ids || db.drawings.map(function (d) { return d.id; })).forEach(function (id) {
      var d = findBy(db.drawings, id);
      if (!d) return;
      var cands = rankCandidates(d, db.drawings, db.settings);
      var cls = classify(cands, db.settings.threshold);
      cands.forEach(function (c) {
        var cmp = compareDrawings(d, findBy(db.drawings, c.id));
        rows.push([d.id, d.partNo, d.rev, c.rank, c.id, c.partNo, c.rev, c.groupId, c.total,
          c.items.family, c.items.usage, c.items.parts, c.items.text, c.items.shape,
          c.rank === 1 ? cls.text : '', cmp.common.join(' / '), cmp.diff.join(' / ')]);
      });
    });
    return rows;
  }

  function sheetGroups(db) {
    var rows = [['그룹 ID', '그룹명', '대표도면', '대표도면 품번', '분류기준', '확정자', '확정일', '소속 도면 수', '소속 도면 품번', '관련 ECN 수', '메모']];
    db.groups.forEach(function (g) {
      var mem = db.drawings.filter(function (d) { return d.groupId === g.id; });
      var rep = findBy(db.drawings, g.repDrawingId);
      var ecn = db.ecns.filter(function (e) { return ecnGroupId(db, e) === g.id; }).length;
      rows.push([g.id, g.name, g.repDrawingId, rep ? rep.partNo : '', g.criteria, g.confirmedBy, g.confirmedAt, mem.length,
        mem.map(function (d) { return d.partNo + (d.rev ? ' ' + d.rev : ''); }).join(', '), ecn, g.memo]);
    });
    return rows;
  }

  function ecnGroupId(db, e) {
    if (e.groupId) return e.groupId;
    var d = findBy(db.drawings, e.drawingAfterId) || findBy(db.drawings, e.drawingBeforeId);
    return d ? d.groupId || '' : '';
  }

  function sheetEcnSummary(db, today) {
    var rows = [['ECN 번호', '상태', '고객사', '기종', '변경 전 품번', '변경 후 품번', '품명', 'REV (전→후)', '변경 사유 구분', '설계 변경 목적',
      '설변 종류', '접수일', '제품 적용일', '유사 그룹', '변경자재 유형별 건수', '재고처리 미정', '영향도 검토', '수평전개', '종결 판정', '지연']];
    db.ecns.forEach(function (e) {
      var c = closureCheck(e);
      rows.push([e.ecnNo, e.status, e.customer, e.model, e.partNoBefore, e.partNoAfter, e.partName,
        (e.revBefore || '') + ' → ' + (e.revAfter || ''), e.reasonType, e.purpose, e.changeKind, e.receivedDate, e.applyDate,
        ecnGroupId(db, e), typeCountText(e.materials), stockUndecided(e.materials) + ' 건', c.impacts, c.horizontal, c.verdict,
        ecnDelayed(e, today) ? '지연' : '']);
    });
    return rows;
  }

  function sheetMaterials(db, ecnId) {
    var rows = [['ECN 번호', 'No', '변경 유형', '적용 위치 (커넥터·회로)', '변경 전 자재품번', '변경 전 사양 (품명)', '변경 전 수량', '단위',
      '변경 후 자재품번', '변경 후 사양 (품명)', '변경 후 수량', '증감 (자동)', '재고 처리', '담당 부서', '현재고 (구자재)']];
    db.ecns.forEach(function (e) {
      if (ecnId && e.id !== ecnId) return;
      filledMaterials(e.materials).forEach(function (m, i) {
        rows.push([e.ecnNo, i + 1, m.type, m.location, m.beforeNo, m.beforeSpec, m.beforeQty, m.unit, m.afterNo, m.afterSpec,
          m.afterQty, materialDelta(m), m.stock, m.dept, m.currentStock]);
      });
    });
    return rows;
  }

  function sheetActions(db, today) {
    var rows = [['ECN 번호', '검토 항목', '해당 여부', '변경 전 기록물', '변경 후 기록물', '조치 내용', '담당 부서', '담당자', '완료 예정일', '완료일', '상태 (자동)']];
    db.ecns.forEach(function (e) {
      (e.impacts || []).forEach(function (i) {
        if (i.applies === '비해당') return;
        rows.push([e.ecnNo, i.item, i.applies, i.beforeDoc, i.afterDoc, i.action, i.dept, i.person, i.due, i.done, impactStatus(i, today)]);
      });
    });
    return rows;
  }

  function sheetHitCheck(db) {
    var h = hitCheck(db, 3);
    var rows = [['도면 ID', '품번', 'REV', '담당자 정답 그룹', '1순위 (품번 · 점수 · 그룹)', '2순위', '3순위', '적중 여부', '적중 순위']];
    function c(x) { return x ? x.partNo + ' · ' + x.total + '점 · ' + (x.groupId || '미분류') : ''; }
    h.rows.forEach(function (r) {
      rows.push([r.drawingId, r.partNo, r.rev, r.answer, c(r.cands[0]), c(r.cands[1]), c(r.cands[2]), r.hit ? '적중' : '미적중', r.hitRank]);
    });
    rows.push([]);
    rows.push(['평가 건수', h.total]);
    rows.push(['적중 건수', h.hits]);
    rows.push(['적중률(%)', h.rate == null ? '' : h.rate]);
    rows.push(['교육단계 목표', '상위 3개 후보 적중률 70퍼센트 이상 (원문 성과지표)']);
    return rows;
  }

  // ── 설계변경통보서 1건 (ECN OUTPUT 양식 배치, A~P 16열) ─────────
  // 셀 값은 계산된 값으로 넣습니다(수식 대신). merges 는 양식의 병합 범위를 따릅니다.
  // opt.figure = {heightPx, caption} 이면 9절에 그림 자리를 비워 두고 그 위치를 figure 로 돌려줍니다(그림은 xlsx-image.js 가 넣음).
  function ecnReport(e, today, opt) {
    opt = opt || {};
    var R = [];
    function row(n) { while (R.length < n) R.push(new Array(16).fill('')); return R[n - 1]; }
    function set(ref, v) {
      var m = ref.match(/^([A-P])(\d+)$/);
      row(+m[2])[m[1].charCodeAt(0) - 65] = v == null ? '' : v;
    }
    var merges = [];
    function mg(r) { merges.push(r); }
    set('C1', '설 계 변 경 통 보 서\n(ENGINEERING CHANGE REPORT)'); mg('C1:K4'); mg('A1:B4');
    set('L1', '결\n재'); mg('L1:L2');
    set('M1', '작성'); set('N1', '검토'); set('O1', '승인'); set('P1', '접수(품질)');
    var ap = e.approval || {};
    set('M2', ap.writer); set('N2', ap.reviewer); set('O2', ap.approver); set('P2', ap.receiver);
    set('A5', 'ECN 번호'); mg('A5:B5'); set('C5', e.ecnNo); mg('C5:D5');
    set('E5', '문서분류'); set('F5', e.docClass); set('G5', '작성 일자'); mg('G5:H5'); set('I5', e.writtenDate);
    set('J5', '설변 종류'); set('K5', e.changeKind); set('L5', '접수일'); set('M5', e.receivedDate); set('N5', '개정 번호'); set('O5', e.revNo);
    set('A6', '1. 기본 정보'); mg('A6:P6');
    var info = [[7, '기종', e.model, '품번 (변경 후)', e.partNoAfter, '변경 전 품번', e.partNoBefore],
      [8, '품명', e.partName, '고객사', e.customer, '고객 담당자', e.customerContact],
      [9, '변경 사유 구분', e.reasonType, '도면 REV (전→후)', (e.revBefore || e.revAfter) ? (e.revBefore || '') + ' → ' + (e.revAfter || '') : '', '요청 출처', e.requestSource]];
    info.forEach(function (x) {
      var r = x[0];
      set('A' + r, x[1]); mg('A' + r + ':B' + r); set('C' + r, x[2]); mg('C' + r + ':E' + r);
      set('F' + r, x[3]); mg('F' + r + ':G' + r); set('H' + r, x[4]); mg('H' + r + ':J' + r);
      set('K' + r, x[5]); mg('K' + r + ':L' + r); set('M' + r, x[6]); mg('M' + r + ':P' + r);
    });
    set('A10', '설계 변경 목적'); mg('A10:B10'); set('C10', e.purpose); mg('C10:P10');
    set('A11', '2. 변경 내용 요약'); mg('A11:P11');
    set('A12', '변경 전 (요청 내용)'); mg('A12:H12'); set('I12', '변경 후 (요청 사유 · 변경 내용)'); mg('I12:P12');
    set('A13', e.beforeText); mg('A13:H17'); set('I13', e.afterText); mg('I13:P17');
    set('A18', '3. 적용 시점 및 재고 처리'); mg('A18:H18'); set('I18', '4. 수신 부서 확인'); mg('I18:P18');
    set('A19', '제품 적용일'); mg('A19:B19'); set('C19', e.applyDate); mg('C19:D19');
    set('E19', '납품 적용일'); mg('E19:F19'); set('G19', e.deliveryApply); mg('G19:H19');
    set('I19', '수신 부서'); mg('I19:J19'); set('K19', '확인자'); mg('K19:L19'); set('M19', '확인일'); mg('M19:N19'); set('O19', '비고'); mg('O19:P19');
    set('A20', '적용 조건'); mg('A20:B20'); set('C20', e.applyCondition); mg('C20:D20');
    set('E20', '적용 LOT·S/N'); mg('E20:F20'); set('G20', e.applyLot); mg('G20:H20');
    set('A21', '선적용 여부'); mg('A21:B21'); set('C21', e.preApply); mg('C21:D21');
    set('E21', '정규 설변 예정일'); mg('E21:F21'); set('G21', e.regularDate); mg('G21:H21');
    set('A22', '재고 처리 방안 (종합)'); mg('A22:H22'); set('A23', e.stockPlan); mg('A23:H25');
    (e.receipts || []).slice(0, 6).forEach(function (rc, i) {
      var r = 20 + i;
      set('I' + r, rc.dept); mg('I' + r + ':J' + r); set('K' + r, rc.person); mg('K' + r + ':L' + r);
      set('M' + r, rc.date); mg('M' + r + ':N' + r); set('O' + r, rc.note); mg('O' + r + ':P' + r);
    });
    set('A26', '5. 변경자재 내역  — 신규 · 삭제 · 대체 · 수량변경 · 사양변경'); mg('A26:P26');
    ['No', '변경 유형', '적용 위치\n(커넥터·회로)', '변경 전\n자재품번', '변경 전 사양 (품명)', '', '변경 전\n수량', '단위', '변경 후\n자재품번',
      '변경 후 사양 (품명)', '', '변경 후\n수량', '증감\n(자동)', '재고 처리', '담당 부서', '현재고\n(구자재)'].forEach(function (h, i) { row(27)[i] = h; });
    mg('E27:F27'); mg('J27:K27');
    var mats = filledMaterials(e.materials);
    var nRows = Math.max(10, mats.length); // 양식은 10행, 넘치면 늘립니다
    var extra = nRows - 10;
    for (var i = 0; i < nRows; i++) {
      var r = 28 + i, m = mats[i];
      var line = row(r);
      line[0] = i + 1;
      if (m) {
        line[1] = m.type; line[2] = m.location; line[3] = m.beforeNo; line[4] = m.beforeSpec; line[6] = m.beforeQty; line[7] = m.unit;
        line[8] = m.afterNo; line[9] = m.afterSpec; line[11] = m.afterQty; line[12] = materialDelta(m); line[13] = m.stock; line[14] = m.dept; line[15] = m.currentStock;
      }
      mg('E' + r + ':F' + r); mg('J' + r + ':K' + r);
    }
    var o = extra; // 이후 행 번호 밀림
    function at(ref) { var m = ref.match(/^([A-P])(\d+)$/); return m[1] + (+m[2] + o); }
    function rg(a, b) { mg(at(a) + ':' + at(b)); }
    set(at('A38'), '유형별 건수 (자동)'); rg('A38', 'C38'); set(at('D38'), typeCountText(e.materials)); rg('D38', 'K38');
    set(at('L38'), '재고처리 미정'); set(at('N38'), stockUndecided(e.materials) + ' 건');
    set(at('A39'), "6. 영향도 검토 및 부서별 조치  (기존 '변경 전/후 기록물' 확장)"); rg('A39', 'P39');
    set(at('A40'), '검토 항목'); rg('A40', 'B40'); set(at('C40'), '해당 여부'); set(at('D40'), '변경 전 기록물\n(번호·REV)'); rg('D40', 'E40');
    set(at('F40'), '변경 후 기록물\n(번호·REV)'); rg('F40', 'H40'); set(at('I40'), '조치 내용'); rg('I40', 'J40');
    set(at('K40'), '담당 부서'); set(at('L40'), '담당자'); set(at('M40'), '완료 예정일'); set(at('N40'), '완료일'); set(at('O40'), '상태 (자동)');
    (e.impacts || []).forEach(function (it, k) {
      var r = 41 + k;
      set(at('A' + r), it.item); rg('A' + r, 'B' + r); set(at('C' + r), it.applies);
      set(at('D' + r), it.beforeDoc); rg('D' + r, 'E' + r); set(at('F' + r), it.afterDoc); rg('F' + r, 'H' + r);
      set(at('I' + r), it.action); rg('I' + r, 'J' + r); set(at('K' + r), it.dept); set(at('L' + r), it.person);
      set(at('M' + r), it.due); set(at('N' + r), it.done); set(at('O' + r), impactStatus(it, today));
    });
    set(at('A50'), '7. 수평전개 검토  — 동일 그룹 · 유사 도면 · 공용 자재 적용 품번'); rg('A50', 'P50');
    set(at('A51'), '대상 품번'); rg('A51', 'C51'); set(at('D51'), '기종'); rg('D51', 'E51'); set(at('F51'), '고객사'); rg('F51', 'G51');
    set(at('H51'), '관계'); rg('H51', 'I51'); set(at('J51'), '적용 여부'); rg('J51', 'K51'); set(at('L51'), '검토 결과 · 사유'); rg('L51', 'P51');
    var hz = (e.horizontal || []).filter(function (h) { return !isBlank(h.partNo); });
    var hRows = Math.max(4, hz.length);
    var o2 = hRows - 4;
    for (var j = 0; j < hRows; j++) {
      var rr = 52 + j, h = hz[j] || {};
      set(at('A' + rr), h.partNo); rg('A' + rr, 'C' + rr); set(at('D' + rr), h.model); rg('D' + rr, 'E' + rr);
      set(at('F' + rr), h.customer); rg('F' + rr, 'G' + rr); set(at('H' + rr), h.relation); rg('H' + rr, 'I' + rr);
      set(at('J' + rr), h.applies); rg('J' + rr, 'K' + rr); set(at('L' + rr), h.result); rg('L' + rr, 'P' + rr);
    }
    o += o2;
    var c = closureCheck(e);
    set(at('A56'), '8. ECN 종결 확인 (자동 판정)'); rg('A56', 'H56'); set(at('I56'), '기타 / 특이 사항'); rg('I56', 'P56');
    [['적용 시점 · 재고 처리 방안', c.apply], ['변경자재 재고 처리 지정', c.materials], ['영향도 검토 · 부서 조치', c.impacts],
      ['수평전개 검토', c.horizontal], ['종결 판정', c.verdict]].forEach(function (x, k) {
      var r = 57 + k;
      set(at('A' + r), x[0]); rg('A' + r, 'D' + r); set(at('E' + r), x[1]); rg('E' + r, 'H' + r);
    });
    set(at('I57'), e.remarks); rg('I57', 'P61');
    set(at('A62'), '9. 설계 변경 상세 — 변경 전 / 변경 후 (도면 캡처·사진 첨부)'); rg('A62', 'P62');
    var figure = null, rowsHpx = [];
    if (opt.figure) {
      // 9절: 첫 줄은 설명, 그 아래 13줄(64~76행)을 그림 높이에 맞춰 늘립니다
      set(at('A63'), [e.detailMemo, opt.figure.caption].filter(function (x) { return !isBlank(x); }).join('\n')); rg('A63', 'P63');
      var r63 = +at('A63').slice(1);
      rowsHpx[r63 - 1] = 48;
      var per = Math.max(20, Math.ceil((opt.figure.heightPx || 260) / 13));
      for (var fr = 1; fr <= 13; fr++) rowsHpx[r63 - 1 + fr] = per;
      figure = { row: r63, col: 0 }; // 0부터 센 행 번호(= 엑셀 64행)
    } else {
      set(at('A63'), e.detailMemo || '(도면 비교 화면에서 내보내면 이 자리에 비교 그림이 들어갑니다. 여기서 내보낸 파일에는 캡처를 직접 붙여 넣으세요.)'); rg('A63', 'P76');
    }
    set(at('A77'), '10. 회의록 / 협의 내용'); rg('A77', 'P77');
    set(at('A78'), e.meetingMemo); rg('A78', 'P89');
    row(89 + o);
    return { rows: R, merges: merges, widths: [5, 11, 18, 15, 9, 12, 9, 7, 15, 10, 13, 9, 11, 16, 10, 11], figure: figure, rowsHpx: rowsHpx };
  }

  // ── 도면 비교 (2026-09-29 추가 요청) ──────────────
  // 비트맵은 {w, h, 배열} 대신 배열과 w·h 를 따로 받습니다. 마스크 = Uint8Array(w*h), 1 = 선(잉크), 0 = 빈 곳.

  // 이진화: RGBA 픽셀 → 마스크. 투명한 곳은 흰 바탕으로 봅니다.
  // 세 채널 중 가장 어두운 값으로 판정합니다 — CAD PDF 의 파랑·하늘색·초록 선도 선으로 잡기 위해서입니다
  // (밝기 평균으로 보면 하늘색(0,255,255) 선이 밝게 나와 빠집니다. 2026-09-29 실제 도면 확인).
  function binarize(rgba, w, h, threshold) {
    var thr = threshold == null ? 160 : threshold;
    var n = w * h, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * 4, a = rgba[p + 3] / 255;
      var m = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]);
      var v = m * a + 255 * (1 - a);
      out[i] = v < thr ? 1 : 0;
    }
    return out;
  }

  // 팽창(dilate): 선을 사방 r 픽셀만큼 두껍게 — 가로·세로 두 번 훑어 정사각형 창과 같은 결과를 냅니다.
  function dilate(mask, w, h, r) {
    r = Math.max(0, Math.floor(r || 0));
    if (!r) return new Uint8Array(mask);
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), x, y, cnt;
    for (y = 0; y < h; y++) {
      var row = y * w; cnt = 0;
      for (x = 0; x < Math.min(r, w); x++) cnt += mask[row + x];
      for (x = 0; x < w; x++) {
        if (x + r < w) cnt += mask[row + x + r];
        if (x - r - 1 >= 0) cnt -= mask[row + x - r - 1];
        tmp[row + x] = cnt > 0 ? 1 : 0;
      }
    }
    for (x = 0; x < w; x++) {
      cnt = 0;
      for (y = 0; y < Math.min(r, h); y++) cnt += tmp[y * w + x];
      for (y = 0; y < h; y++) {
        if (y + r < h) cnt += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) cnt -= tmp[(y - r - 1) * w + x];
        out[y * w + x] = cnt > 0 ? 1 : 0;
      }
    }
    return out;
  }

  // 차이: B에만 있는 선(added, 적색) · A에만 있는 선(removed, 파랑). tol 픽셀 안의 흔들림은 같은 선으로 봅니다.
  function diffMasks(a, b, w, h, tol) {
    var da = dilate(a, w, h, tol), db = dilate(b, w, h, tol);
    var n = w * h, added = new Uint8Array(n), removed = new Uint8Array(n), na = 0, nr = 0, inkA = 0, inkB = 0;
    for (var i = 0; i < n; i++) {
      inkA += a[i]; inkB += b[i];
      if (b[i] && !da[i]) { added[i] = 1; na++; }
      if (a[i] && !db[i]) { removed[i] = 1; nr++; }
    }
    return { added: added, removed: removed, addedCount: na, removedCount: nr, inkA: inkA, inkB: inkB };
  }

  // 연결요소: 8방향으로 이어진 점을 한 덩어리로. gap 픽셀 안에 떨어진 조각은 한 상자로 묶고,
  // 면적(실제 선 픽셀 수)이 minArea 보다 작은 점 잡음은 버립니다. 위→아래, 왼→오른 순서.
  function components(mask, w, h, opt) {
    opt = opt || {};
    var gap = Math.max(0, Math.floor(opt.gap || 0)), minArea = opt.minArea == null ? 1 : opt.minArea;
    var lab = gap ? dilate(mask, w, h, gap) : mask;
    var seen = new Uint8Array(w * h), stack = new Int32Array(w * h), out = [];
    for (var s = 0; s < w * h; s++) {
      if (!lab[s] || seen[s]) continue;
      var sp = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
      stack[sp++] = s; seen[s] = 1;
      while (sp) {
        var i = stack[--sp], x = i % w, y = (i - x) / w;
        if (mask[i]) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        for (var dy = -1; dy <= 1; dy++) {
          var ny = y + dy; if (ny < 0 || ny >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx; if (nx < 0 || nx >= w) continue;
            var j = ny * w + nx;
            if (lab[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
          }
        }
      }
      if (area >= minArea && x1 >= 0) out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area: area, cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2) });
    }
    out.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
    return out;
  }

  // 차이 영역 목록: 추가(B에만)·삭제(A에만) 상자를 합쳐 번호를 매깁니다.
  function diffRegions(diff, w, h, opt) {
    var list = [];
    components(diff.added, w, h, opt).forEach(function (c) { c.type = '추가'; list.push(c); });
    components(diff.removed, w, h, opt).forEach(function (c) { c.type = '삭제'; list.push(c); });
    list.sort(function (p, q) { return p.y - q.y || p.x - q.x; });
    list.forEach(function (c, i) { c.no = i + 1; });
    return list;
  }

  // 유사변환(이동·회전·배율) 최소제곱 추정: src(B 좌표) → dst(A 좌표).
  // x' = a·x − b·y + tx,  y' = b·x + a·y + ty.  점 1쌍이면 배율 fallbackScale 고정·이동만.
  function fitSimilarity(src, dst, fallbackScale) {
    var n = Math.min(src.length, dst.length);
    if (!n) return null;
    var T;
    if (n === 1) {
      var s = fallbackScale || 1;
      T = { a: s, b: 0, tx: dst[0].x - s * src[0].x, ty: dst[0].y - s * src[0].y };
    } else {
      var msx = 0, msy = 0, mdx = 0, mdy = 0, i;
      for (i = 0; i < n; i++) { msx += src[i].x; msy += src[i].y; mdx += dst[i].x; mdy += dst[i].y; }
      msx /= n; msy /= n; mdx /= n; mdy /= n;
      var sxx = 0, pa = 0, pb = 0;
      for (i = 0; i < n; i++) {
        var sx = src[i].x - msx, sy = src[i].y - msy, dx = dst[i].x - mdx, dy = dst[i].y - mdy;
        sxx += sx * sx + sy * sy; pa += sx * dx + sy * dy; pb += sx * dy - sy * dx;
      }
      if (!sxx) return fitSimilarity(src.slice(0, 1), dst.slice(0, 1), fallbackScale);
      var a = pa / sxx, b = pb / sxx;
      T = { a: a, b: b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) };
    }
    T.scale = Math.sqrt(T.a * T.a + T.b * T.b);
    T.angle = Math.atan2(T.b, T.a) * 180 / Math.PI;
    var se = 0;
    for (var k = 0; k < n; k++) {
      var p = applySimilarity(T, src[k]);
      se += Math.pow(p.x - dst[k].x, 2) + Math.pow(p.y - dst[k].y, 2);
    }
    T.rms = Math.sqrt(se / n);
    return T;
  }
  function applySimilarity(T, p) { return { x: T.a * p.x - T.b * p.y + T.tx, y: T.b * p.x + T.a * p.y + T.ty }; }

  // ── 표 비교 (BOM·부품 목록) ───────────────
  var KEY_HINTS = /품번|자재\s*코드|자재\s*번호|부품\s*번호|품목\s*코드|PART\s*NO|P\/N|ITEM\s*CODE|MATERIAL/i;
  function guessKeyColumn(headers) {
    for (var i = 0; i < headers.length; i++) if (KEY_HINTS.test(String(headers[i]))) return headers[i];
    return headers[0] || '';
  }
  // 엑셀에서 복사해 붙여 넣은 글(탭 구분) 또는 CSV → 행 객체 목록. 첫 줄은 머리행.
  function parsePastedTable(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return { headers: [], rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headers = lines[0].split(sep).map(function (x) { return x.trim(); });
    var rows = lines.slice(1).map(function (l) {
      var cells = l.split(sep), o = {};
      headers.forEach(function (hd, i) { o[hd] = cells[i] == null ? '' : cells[i].trim(); });
      return o;
    });
    return { headers: headers, rows: rows };
  }
  function sameCell(x, y) {
    var nx = toNum(x), ny = toNum(y);
    if (nx != null && ny != null) return nx === ny;
    return norm(x) === norm(y);
  }
  // 두 표를 key 열로 맞대어 추가·삭제·변경·동일 행을 가립니다. key 는 열 이름 또는 함수.
  // 같은 키가 여러 번 나오면 나온 순서대로 짝을 짓습니다(#2, #3 …).
  function tableDiff(rowsA, rowsB, opt) {
    opt = opt || {};
    var keyOf = typeof opt.key === 'function' ? opt.key : function (r) { return r[opt.key]; };
    function keyed(rows) {
      var seen = {};
      return rows.map(function (r) {
        var k = norm(keyOf(r));
        seen[k] = (seen[k] || 0) + 1;
        return { k: seen[k] > 1 ? k + '#' + seen[k] : k, label: keyOf(r), r: r };
      }).filter(function (x) { return x.k !== ''; });
    }
    var ka = keyed(rowsA || []), kb = keyed(rowsB || []);
    var cols = opt.cols;
    if (!cols) {
      cols = [];
      ka.concat(kb).forEach(function (x) { Object.keys(x.r).forEach(function (c) { if (c !== opt.key && cols.indexOf(c) < 0) cols.push(c); }); });
    }
    var mapA = {}, mapB = {};
    ka.forEach(function (x) { mapA[x.k] = x; });
    kb.forEach(function (x) { mapB[x.k] = x; });
    var out = kb.map(function (x) {
      var a = mapA[x.k];
      if (!a) return { _k: x.k, key: x.label, status: '추가', a: null, b: x.r, changed: [] };
      var changed = cols.filter(function (c) { return !sameCell(a.r[c], x.r[c]); });
      return { _k: x.k, key: x.label, status: changed.length ? '변경' : '동일', a: a.r, b: x.r, changed: changed };
    });
    // A에만 있는 행은 A에서 바로 앞에 있던 행 뒤에 끼워 넣어 원래 순서를 살립니다.
    var prev = null;
    ka.forEach(function (x) {
      if (mapB[x.k]) { prev = x.k; return; }
      var at = 0;
      for (var i = 0; i < out.length; i++) if (out[i]._k === prev) { at = i + 1; break; }
      if (prev === null) at = 0;
      while (at < out.length && out[at].status === '삭제') at++;
      out.splice(at, 0, { _k: x.k, key: x.label, status: '삭제', a: x.r, b: null, changed: [] });
    });
    out.forEach(function (r) { delete r._k; });
    var counts = { 추가: 0, 삭제: 0, 변경: 0, 동일: 0 };
    out.forEach(function (r) { counts[r.status]++; });
    return { cols: cols, rows: out, counts: counts };
  }
  // 등록된 도면 정보 → 비교용 부품 표(정보 칸 + 커넥터·전선 목록, 같은 품번이 여러 번이면 수량으로 셉니다)
  function drawingPartRows(d) {
    var rows = [];
    ['partName', 'rev', 'customer', 'model', 'usage', 'circuits', 'branches'].forEach(function (k) {
      rows.push({ 구분: '도면 정보', 항목: FIELD_LABEL[k] || k, 값: d[k] == null ? '' : String(d[k]) });
    });
    [['connectors', '커넥터'], ['wires', '전선·보호재'], ['keywords', '구조 키워드']].forEach(function (p) {
      var cnt = {}, order = [];
      splitList(d[p[0]]).forEach(function (x) { if (!cnt[x]) order.push(x); cnt[x] = (cnt[x] || 0) + 1; });
      order.forEach(function (x) { rows.push({ 구분: p[1], 항목: x, 값: String(cnt[x]) }); });
    });
    return rows;
  }
  function partRowKey(r) { return r.구분 + ' · ' + r.항목; }
  function sheetTableDiff(res, keyLabel) {
    var head = ['상태', keyLabel || '키'];
    res.cols.forEach(function (c) { head.push(c + ' (A)', c + ' (B)'); });
    head.push('바뀐 칸');
    var rows = [head];
    res.rows.forEach(function (r) {
      var line = [r.status, r.key];
      res.cols.forEach(function (c) { line.push(r.a ? r.a[c] : '', r.b ? r.b[c] : ''); });
      line.push(r.changed.join(', '));
      rows.push(line);
    });
    return rows;
  }


  // ── 도면 비교 2차 (2026-09-29 오후 — 실제 CAD PDF 두 쌍으로 조정) ──────────

  // 도곽(도면 테두리) 찾기: 가로·세로로 길게 이어진 선(폭의 frac 이상이 선인 행·열) 중 가장 바깥 것.
  // 못 찾으면 선 전체의 외곽 사각형을 돌려줍니다. {x0, y0, x1, y1, kind: 'frame' | 'ink' }
  function findFrame(mask, w, h, frac) {
    frac = frac || 0.5;
    var rows = new Int32Array(h), cols = new Int32Array(w), x, y, any = false;
    for (y = 0; y < h; y++) {
      var r = y * w;
      for (x = 0; x < w; x++) if (mask[r + x]) { rows[y]++; cols[x]++; any = true; }
    }
    if (!any) return null;
    function first(arr, n, lim) { for (var i = 0; i < n; i++) if (arr[i] >= lim) return i; return -1; }
    function last(arr, n, lim) { for (var i = n - 1; i >= 0; i--) if (arr[i] >= lim) return i; return -1; }
    var y0 = first(rows, h, w * frac), y1 = last(rows, h, w * frac), x0 = first(cols, w, h * frac), x1 = last(cols, w, h * frac);
    if (y0 >= 0 && x0 >= 0 && y1 - y0 > h * 0.3 && x1 - x0 > w * 0.3) return { x0: x0, y0: y0, x1: x1, y1: y1, kind: 'frame' };
    y0 = first(rows, h, 1); y1 = last(rows, h, 1); x0 = first(cols, w, 1); x1 = last(cols, w, 1);
    return { x0: x0, y0: y0, x1: x1, y1: y1, kind: 'ink' };
  }
  // 두 도곽 사각형의 네 모서리로 B → A 유사변환을 구합니다
  function frameTransform(fb, fa) {
    if (!fa || !fb) return null;
    function corners(f) { return [{ x: f.x0, y: f.y0 }, { x: f.x1, y: f.y0 }, { x: f.x1, y: f.y1 }, { x: f.x0, y: f.y1 }]; }
    return fitSimilarity(corners(fb), corners(fa));
  }
  // 미세 이동 보정: A 의 선 점(최대 maxSamples 개를 고르게 뽑음)이 B 선과 겹치는 개수가 가장 많은 (dx, dy) 를 ±r 안에서 찾습니다.
  // B 를 (dx, dy) 만큼 옮기면 A 와 가장 잘 겹친다는 뜻입니다. score = 겹친 비율(0~1).
  function bestShift(mA, mB, w, h, r, maxSamples) {
    r = r == null ? 6 : r; maxSamples = maxSamples || 40000;
    var ink = 0, i;
    for (i = 0; i < w * h; i++) ink += mA[i];
    if (!ink) return { dx: 0, dy: 0, score: 0 };
    var step = Math.max(1, Math.floor(ink / maxSamples)), pts = [], k = 0;
    for (i = 0; i < w * h; i++) if (mA[i] && (k++ % step === 0)) pts.push(i);
    var best = { dx: 0, dy: 0, score: -1 }, base = -1;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var hit = 0;
        for (var j = 0; j < pts.length; j++) {
          var p = pts[j], x = p % w, y = (p - x) / w, bx = x - dx, by = y - dy;
          if (bx >= 0 && by >= 0 && bx < w && by < h && mB[by * w + bx]) hit++;
        }
        var sc = hit / pts.length;
        if (dx === 0 && dy === 0) base = sc;
        // 같은 점수면 덜 움직인 쪽을 고릅니다
        if (sc > best.score + 1e-9 || (Math.abs(sc - best.score) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx: dx, dy: dy, score: sc };
      }
    }
    best.base = base;
    return best;
  }
  function composeShift(T, dx, dy) {
    var o = { a: T.a, b: T.b, tx: T.tx + dx, ty: T.ty + dy };
    o.scale = Math.sqrt(o.a * o.a + o.b * o.b); o.angle = Math.atan2(o.b, o.a) * 180 / Math.PI; o.rms = T.rms || 0;
    return o;
  }

  // 차이 영역마다 「조금 옮겨진 것뿐인지」 확인합니다. 영역 안의 선 점(추가 = B 선, 삭제 = A 선)을 ±r 픽셀 옮겨 보아
  // 상대 도면 선과 거의 다 겹치는 자리가 있으면 moved = {dx, dy} 를 붙입니다(내용은 같고 위치만 바뀐 표·블록).
  // dA·dB 는 허용치만큼 팽창한 A·B 마스크. 옮겨도 설명이 안 되면(값이 바뀐 글자 등) moved 는 없습니다.
  function markMoved(regions, mA, mB, dA, dB, w, h, r, opt) {
    opt = opt || {};
    var need = opt.need == null ? 0.97 : opt.need, maxPts = opt.maxPts || 600;
    regions.forEach(function (g) {
      var src = g.type === '추가' ? mB : mA, dst = g.type === '추가' ? dA : dB;
      var pts = [], x, y;
      for (y = g.y; y < g.y + g.h; y++) for (x = g.x; x < g.x + g.w; x++) if (src[y * w + x]) pts.push(y * w + x);
      if (pts.length < (opt.minPts || 150)) return;   // 글자 한두 개 크기의 작은 차이는 우연히 겹치는 자리가 있어 판단하지 않습니다
      if (pts.length > maxPts) { var st = pts.length / maxPts, q = []; for (var k = 0; k < maxPts; k++) q.push(pts[Math.floor(k * st)]); pts = q; }
      function score(dx, dy) {
        var hit = 0;
        for (var j = 0; j < pts.length; j++) {
          var p = pts[j], px = p % w, py = (p - px) / w, tx = px + dx, ty = py + dy;
          if (tx >= 0 && ty >= 0 && tx < w && ty < h && dst[ty * w + tx]) hit++;
        }
        return hit / pts.length;
      }
      var s0 = score(0, 0), best = { dx: 0, dy: 0, s: s0 };
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (!dx && !dy) continue;
        var sc = score(dx, dy);
        if (sc > best.s) best = { dx: dx, dy: dy, s: sc };
      }
      if ((best.dx || best.dy) && best.s >= need && s0 < need - 0.1) g.moved = { dx: g.type === '추가' ? -best.dx : best.dx, dy: g.type === '추가' ? -best.dy : best.dy, match: best.s };
    });
    return regions;
  }

  // ── 멀리 옮겨진 선 찾기 (2026-09-29 저녁 「문의02」) ──────────
  // markMoved 는 몇 픽셀 밀린 영역만 봅니다. 표에 줄이 끼어들어 아래 줄이 몇 줄 내려가거나 커넥터 묶음을 도면 반대쪽으로
  // 옮기면, 내용은 같은데 옮긴 자리 전체가 적색(추가)·파랑(삭제)으로 나옵니다. 여기서는 그런 선을 「이동」으로 걸러 냅니다.
  //  1) 차이 선을 글자·기호 크기의 작은 조각으로 나눕니다(gap 2 픽셀 — 낱말 하나, 기호 하나 정도).
  //  2) B 에 새로 생긴 조각과 A 에서 사라진 조각 가운데 크기·면적이 거의 같은 것끼리 「옮긴 거리 d」 에 표를 던집니다.
  //     같이 옮겨진 무리(표의 여러 줄, 커넥터 묶음)는 같은 d 에 표가 모여 봉우리가 됩니다.
  //  3) 조각마다 봉우리 d 들을 대 보아, 조각의 선이 d 만큼 떨어진 곳의 「상대 도면에서 사라진/새로 생긴 선」 과 거의 다 겹치면 이동으로 봅니다.
  //     그대로 남아 있는 선이 아니라 사라진 선하고만 맞대므로, 도면 곳곳에 되풀이되는 같은 기호와 우연히 짝이 되지 않습니다.
  //  4) 이동으로 설명되는 점은 diff 에서 빼서 moved 마스크로 옮기고, 설명되지 않는 점(옮긴 뒤 값까지 바뀐 곳)은 적색·파랑으로 남깁니다.
  // d 는 언제나 A 위치 → B 위치(B = A + d). diff 를 직접 고칩니다. 돌려주는 값:
  // {movedAdd, movedDel (Uint8Array), count, peaks: [{dx, dy, votes}], pieces: 이동으로 판정한 조각 수}
  var OFF9 = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  function explainMoves(diff, w, h, opt) {
    opt = opt || {};
    var tol = opt.tol == null ? 1 : opt.tol, need = opt.need == null ? 0.9 : opt.need;
    var minArea = opt.minArea == null ? 12 : opt.minArea, minVotes = opt.minVotes == null ? 3 : opt.minVotes;
    var maxPeaks = opt.maxPeaks || 80, sizeTol = opt.sizeTol == null ? 2 : opt.sizeTol;
    var n = w * h, movedAdd = new Uint8Array(n), movedDel = new Uint8Array(n);
    var res = { movedAdd: movedAdd, movedDel: movedDel, count: 0, peaks: [], pieces: 0 };
    if (!diff.addedCount && !diff.removedCount) return res;
    var pa = components(diff.added, w, h, { gap: 2, minArea: minArea });
    var pd = components(diff.removed, w, h, { gap: 2, minArea: minArea });
    // 2) 크기 칸(가로·세로를 sizeTol+1 로 나눈 칸)으로 묶어 비슷한 조각끼리만 맞댑니다
    var q = sizeTol + 1, bucket = {};
    pd.forEach(function (c) { var k = Math.floor(c.w / q) + ',' + Math.floor(c.h / q); (bucket[k] = bucket[k] || []).push(c); });
    var votes = {};
    pa.forEach(function (c) {
      var bw = Math.floor(c.w / q), bh = Math.floor(c.h / q), seen = {};
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) (bucket[(bw + i) + ',' + (bh + j)] || []).forEach(function (o) {
        if (Math.abs(o.w - c.w) > sizeTol || Math.abs(o.h - c.h) > sizeTol || Math.abs(o.area - c.area) > Math.max(3, 0.2 * c.area)) return;
        var dx = c.cx - o.cx, dy = c.cy - o.cy, key = dx + ',' + dy;
        if (Math.abs(dx) + Math.abs(dy) <= tol + 1 || seen[key]) return;   // 흔들림 수준은 이동이 아닙니다
        seen[key] = 1; votes[key] = (votes[key] || 0) + 1;
      });
    });
    // 봉우리: 표가 많은 d 부터, 이미 고른 봉우리와 2 픽셀 안이면 합칩니다
    var keys = Object.keys(votes).sort(function (x, y) { return votes[y] - votes[x]; }), peaks = [];
    for (var ki = 0; ki < keys.length && peaks.length < maxPeaks; ki++) {
      if (votes[keys[ki]] < minVotes) break;
      var d = keys[ki].split(',').map(Number), near = false;
      for (var pi = 0; pi < peaks.length; pi++) if (Math.abs(peaks[pi].dx - d[0]) <= 2 && Math.abs(peaks[pi].dy - d[1]) <= 2) { peaks[pi].votes += votes[keys[ki]]; near = true; break; }
      if (!near) peaks.push({ dx: d[0], dy: d[1], votes: votes[keys[ki]] });
    }
    peaks.sort(function (x, y) { return y.votes - x.votes; });
    res.peaks = peaks;
    if (!peaks.length) return res;
    var dRem = dilate(diff.removed, w, h, tol + 1), dAdd = dilate(diff.added, w, h, tol + 1);
    // 3) 조각마다 봉우리를 대 봅니다(봉우리 둘레 ±1 픽셀 포함). sign: B 조각은 −d, A 조각은 +d 쪽을 봅니다
    function tryPiece(c, src, target, sign, out) {
      var pts = [];
      for (var y = c.y; y < c.y + c.h; y++) for (var x = c.x; x < c.x + c.w; x++) if (src[y * w + x]) pts.push(x, y);
      var np = pts.length / 2, best = null;
      for (var k = 0; k < peaks.length; k++) {
        for (var oi = 0; oi < OFF9.length; oi++) {
          var ex = OFF9[oi][0], ey = OFF9[oi][1];   // 봉우리 자리를 먼저 — 점수가 같으면 봉우리 값을 씁니다
          var sx = sign * (peaks[k].dx + ex), sy = sign * (peaks[k].dy + ey), hit = 0;
          for (var j = 0; j < pts.length; j += 2) {
            var tx = pts[j] + sx, ty = pts[j + 1] + sy;
            if (tx >= 0 && ty >= 0 && tx < w && ty < h && target[ty * w + tx]) hit++;
          }
          var sc = hit / np;
          if (sc >= need && (!best || sc > best.s)) best = { s: sc, sx: sx, sy: sy, dx: peaks[k].dx + ex, dy: peaks[k].dy + ey };
        }
        if (best && best.s >= 0.999) break;
      }
      if (!best) return;
      res.pieces++;
      // 설명되지 않는 점이 몇 개뿐이면(글자 가장자리 번짐) 조각 전체를 이동으로 봅니다. 많으면 그 점은 적색·파랑으로 남겨 「옮긴 뒤 바뀐 곳」 으로 보입니다
      var whole = (1 - best.s) * np < Math.max(8, 0.1 * np);
      for (var m = 0; m < pts.length; m += 2) {
        var px = pts[m], py = pts[m + 1], qx = px + best.sx, qy = py + best.sy;
        if (whole || (qx >= 0 && qy >= 0 && qx < w && qy < h && target[qy * w + qx])) out[py * w + px] = 1;
      }
      c.d = { dx: best.dx, dy: best.dy };
    }
    pa.forEach(function (c) { tryPiece(c, diff.added, dRem, -1, movedAdd); });
    pd.forEach(function (c) { tryPiece(c, diff.removed, dAdd, 1, movedDel); });
    // 4) 이동 조각 바로 옆에 붙은 부스러기(crumb 점 미만 — 선 번짐·교차점)도 이동으로 합칩니다. 목록이 잘게 쪼개지지 않게 하기 위해서입니다
    var crumb = opt.crumb == null ? 20 : opt.crumb;
    [[diff.added, movedAdd], [diff.removed, movedDel]].forEach(function (pr) {
      var src = pr[0], mv = pr[1], rest = new Uint8Array(n), near = dilate(mv, w, h, opt.crumbReach == null ? 3 : opt.crumbReach);
      for (var i = 0; i < n; i++) rest[i] = src[i] && !mv[i] ? 1 : 0;
      components(rest, w, h, { gap: 1, minArea: 1 }).forEach(function (c) {
        if (c.area >= crumb) return;
        var touch = false, y, x;
        for (y = c.y; y < c.y + c.h && !touch; y++) for (x = c.x; x < c.x + c.w; x++) if (rest[y * w + x] && near[y * w + x]) { touch = true; break; }
        if (!touch) return;
        for (y = c.y; y < c.y + c.h; y++) for (x = c.x; x < c.x + c.w; x++) if (rest[y * w + x]) mv[y * w + x] = 1;
      });
    });
    // 5) 이동으로 설명된 점을 diff 에서 뺍니다
    var na = 0, nr = 0;
    for (var i2 = 0; i2 < n; i2++) {
      if (movedAdd[i2]) { diff.added[i2] = 0; res.count++; }
      if (movedDel[i2]) { diff.removed[i2] = 0; res.count++; }
      na += diff.added[i2]; nr += diff.removed[i2];
    }
    diff.addedCount = na; diff.removedCount = nr;
    res.piecesAdd = pa.filter(function (c) { return c.d; });
    res.piecesDel = pd.filter(function (c) { return c.d; });
    return res;
  }
  // 차이 영역마다 「이동으로 설명되는 몫」을 붙입니다. regions 는 explainMoves 전에 만든 목록(상자 수가 그대로 유지되게),
  // before = explainMoves 전 diff 의 {added, removed} 사본. 몫이 need(기본 0.9) 이상이면 g.moved = {dx, dy, far: true, share} (보라),
  // 그보다 작지만 있으면 g.movedShare 만 붙여 「일부 이동」으로 보입니다(나머지는 옮긴 뒤 달라진 선).
  function tagMovedRegions(regions, before, mv, w, opt) {
    opt = opt || {};
    var need = opt.need == null ? 0.9 : opt.need;
    regions.forEach(function (g) {
      var add = g.type === '추가', src = add ? before.added : before.removed, m = add ? mv.movedAdd : mv.movedDel;
      var all = 0, got = 0;
      for (var y = g.y; y < g.y + g.h; y++) for (var x = g.x; x < g.x + g.w; x++) { var i = y * w + x; if (src[i]) { all++; if (m[i]) got++; } }
      if (!all || !got) return;
      var share = got / all, tally = {}, top = null;
      (add ? mv.piecesAdd : mv.piecesDel).forEach(function (c) {
        if (c.cx < g.x || c.cx > g.x + g.w || c.cy < g.y || c.cy > g.y + g.h) return;
        var k = c.d.dx + ',' + c.d.dy; tally[k] = (tally[k] || 0) + c.area;
        if (!top || tally[k] > tally[top]) top = k;
      });
      var d = top ? top.split(',').map(Number) : [0, 0];
      if (share >= need) g.moved = { dx: d[0], dy: d[1], far: true, share: Math.round(share * 100) / 100, mixed: Object.keys(tally).length > 1 };
      else g.movedShare = Math.round(share * 100) / 100;
    });
    return regions;
  }

  // 블록별 정렬 — 표가 길어져 아래 그림이 통째로 밀린 것처럼 「부분마다 다르게 옮겨진」 개정 도면용.
  // A 를 tile 픽셀 칸으로 나눠 칸마다 B 에서 가장 잘 겹치는 이동(dx, dy)을 찾습니다(B 위치 = A 위치 + d).
  // 먼저 factor 배로 줄인 그림에서 ±R 을 넓게 찾고, 원래 크기에서 ±factor 로 다듬습니다.
  // 돌려주는 값: {cols, rows, tile, dx[], dy[], score[], warped} — warped 는 칸마다 옮겨 A 배치로 맞춘 B 마스크.
  function shrinkMask(m, w, h, f) {
    var sw = Math.ceil(w / f), sh = Math.ceil(h / f), o = new Uint8Array(sw * sh);
    for (var y = 0; y < h; y++) { var sy = (y / f) | 0; for (var x = 0; x < w; x++) if (m[y * w + x]) o[sy * sw + ((x / f) | 0)] = 1; }
    return { m: o, w: sw, h: sh };
  }
  function samplePoints(m, w, x0, y0, x1, y1, maxN) {
    var pts = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) if (m[y * w + x]) pts.push(x, y);
    var n = pts.length / 2;
    if (n <= maxN) return pts;
    var st = n / maxN, q = [];
    for (var k = 0; k < maxN; k++) { var i = Math.floor(k * st) * 2; q.push(pts[i], pts[i + 1]); }
    return q;
  }
  // pen: 멀리 옮길수록 점수를 조금 깎습니다(표처럼 줄이 반복되는 곳에서 한 줄 건너 겹치는 가짜 일치를 막기 위해)
  function bestIn(pts, target, w, h, cx, cy, r, pen) {
    pen = pen || 0;
    var best = { dx: cx, dy: cy, s: -1, raw: 0 }, n = pts.length / 2;
    for (var dy = cy - r; dy <= cy + r; dy++) for (var dx = cx - r; dx <= cx + r; dx++) {
      var hit = 0;
      for (var j = 0; j < pts.length; j += 2) {
        var x = pts[j] + dx, y = pts[j + 1] + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && target[y * w + x]) hit++;
      }
      var raw = hit / n, sc = raw - pen * (Math.abs(dx) + Math.abs(dy));
      if (sc > best.s + 1e-9 || (Math.abs(sc - best.s) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = { dx: dx, dy: dy, s: sc, raw: raw };
    }
    return best;
  }
  function blockAlign(mA, mB, w, h, opt) {
    opt = opt || {};
    var f = opt.factor || 6, tile = opt.tile || 192, R = opt.R || 160, minPts = opt.minPts || 12;
    var pen = opt.penalty == null ? 0.004 : opt.penalty, gain = opt.gain == null ? 0.15 : opt.gain;
    var sa = shrinkMask(mA, w, h, f), sb = shrinkMask(mB, w, h, f);
    var sbd = dilate(sb.m, sb.w, sb.h, 1); // 줄인 그림은 1칸 팽창해 넓게, 원래 크기는 팽창 없이 정확하게 맞춥니다
    var cols = Math.ceil(w / tile), rows = Math.ceil(h / tile), n = cols * rows;
    var dx = new Int32Array(n), dy = new Int32Array(n), score = new Float32Array(n), has = new Uint8Array(n);
    var ts = Math.max(1, Math.round(tile / f)), rs = Math.max(1, Math.round(R / f));
    for (var ty = 0; ty < rows; ty++) for (var tx = 0; tx < cols; tx++) {
      var k = ty * cols + tx;
      var pts = samplePoints(sa.m, sa.w, tx * ts, ty * ts, Math.min(sa.w, (tx + 1) * ts), Math.min(sa.h, (ty + 1) * ts), 300);
      if (pts.length / 2 < minPts) continue;
      var c = bestIn(pts, sbd, sa.w, sa.h, 0, 0, rs, pen);
      var fp = samplePoints(mA, w, tx * tile, ty * tile, Math.min(w, (tx + 1) * tile), Math.min(h, (ty + 1) * tile), 700);
      var fine = bestIn(fp, mB, w, h, c.dx * f, c.dy * f, f);
      // 옮겨도 별로 나아지지 않으면(값이 바뀐 곳) 옮기지 않습니다
      var stay = bestIn(fp, mB, w, h, 0, 0, 0);
      if (fine.raw - stay.raw < gain) fine = stay;
      dx[k] = fine.dx; dy[k] = fine.dy; score[k] = fine.raw; has[k] = 1;
    }
    // 선이 없는 칸은 이웃 칸 값을 이어받습니다(없으면 0)
    for (var pass = 0; pass < 3; pass++) for (var q = 0; q < n; q++) {
      if (has[q]) continue;
      var qx = q % cols, qy = (q - qx) / cols, sx = 0, sy = 0, c2 = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = qx + d[0], ny = qy + d[1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        var j = ny * cols + nx; if (has[j] === 1) { sx += dx[j]; sy += dy[j]; c2++; }
      });
      if (c2) { dx[q] = Math.round(sx / c2); dy[q] = Math.round(sy / c2); has[q] = 2; }
    }
    var warped = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var trow = ((y / tile) | 0) * cols;
      for (var x = 0; x < w; x++) {
        var t = trow + ((x / tile) | 0), bx = x + dx[t], by = y + dy[t];
        if (bx >= 0 && by >= 0 && bx < w && by < h) warped[y * w + x] = mB[by * w + bx];
      }
    }
    return { cols: cols, rows: rows, tile: tile, dx: dx, dy: dy, score: score, warped: warped };
  }

  // 비교 범위 제한: 사각형 roi({x0,y0,x1,y1}) 밖의 차이 점을 지웁니다(배치가 크게 바뀐 도면에서 관심 부분만 볼 때)
  function clipDiff(diff, w, h, roi) {
    if (!roi) return diff;
    var x0 = Math.max(0, Math.floor(roi.x0)), y0 = Math.max(0, Math.floor(roi.y0)), x1 = Math.min(w - 1, Math.ceil(roi.x1)), y1 = Math.min(h - 1, Math.ceil(roi.y1));
    var na = 0, nr = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (x < x0 || x > x1 || y < y0 || y > y1) { diff.added[i] = 0; diff.removed[i] = 0; }
      else { na += diff.added[i]; nr += diff.removed[i]; }
    }
    diff.addedCount = na; diff.removedCount = nr; diff.roi = { x0: x0, y0: y0, x1: x1, y1: y1 };
    return diff;
  }
  // 점 목록을 둘러싼 사각형을 짧은 변의 frac 만큼 넓혀 돌려줍니다
  function pointsBox(pts, frac) {
    if (!pts || pts.length < 2) return null;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var m = Math.max(10, Math.min(x1 - x0, y1 - y0) * (frac == null ? 0.15 : frac));
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  }

  // 글자 비교: PDF 글자 정보(벡터 PDF 만 있음)를 위치로 맞대어 값이 바뀐 글자를 찾습니다.
  // items = [{str, x, y, h}] — x·y 는 글자 가운데, h 는 글자 높이(모두 A 도면 픽셀 좌표로 맞춘 값).
  // 같은 글자가 radius 안에 있으면 동일, 없고 가까운 곳에 다른 글자가 있으면 변경(예: 350 → 450),
  // 아무것도 없으면 추가(B) / 삭제(A). 멀리 옮겨진 같은 글자는 이동으로 묶습니다.
  function textDiff(itemsA, itemsB, opt) {
    opt = opt || {};
    var rk = opt.radius == null ? 1.2 : opt.radius;   // 글자 높이의 몇 배까지를 「같은 자리」로 볼지
    var minR = opt.minRadius == null ? 6 : opt.minRadius;
    function clean(list) { return (list || []).filter(function (t) { return String(t.str || '').trim() !== ''; }).map(function (t) { return { str: String(t.str).trim(), x: t.x, y: t.y, h: t.h || 10, w: t.w, ang: t.ang }; }); }
    var A = clean(itemsA), B = clean(itemsB);
    var usedA = new Uint8Array(A.length), usedB = new Uint8Array(B.length);
    var same = 0;
    function d2(p, q) { return (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y); }
    function rad(p, q) { var r = Math.max(minR, rk * Math.max(p.h, q.h)); return r * r; }
    var i, j;
    // 1) 같은 글자 · 같은 자리
    for (j = 0; j < B.length; j++) {
      var bi = -1, bd = Infinity;
      for (i = 0; i < A.length; i++) {
        if (usedA[i] || A[i].str !== B[j].str) continue;
        var d = d2(A[i], B[j]);
        if (d <= rad(A[i], B[j]) && d < bd) { bd = d; bi = i; }
      }
      if (bi >= 0) { usedA[bi] = 1; usedB[j] = 1; same++; }
    }
    var out = [];
    // 2) 같은 자리의 다른 글자 → 변경
    for (j = 0; j < B.length; j++) {
      if (usedB[j]) continue;
      var ci = -1, cd = Infinity;
      for (i = 0; i < A.length; i++) {
        if (usedA[i]) continue;
        var dd = d2(A[i], B[j]);
        if (dd <= rad(A[i], B[j]) && dd < cd) { cd = dd; ci = i; }
      }
      if (ci >= 0) { usedA[ci] = 1; usedB[j] = 1; out.push({ type: '변경', a: A[ci], b: B[j] }); }
    }
    // 3) 남은 것: 같은 글자가 먼 곳에 하나씩 남아 있으면 이동, 아니면 추가·삭제
    var restA = [], restB = [];
    for (i = 0; i < A.length; i++) if (!usedA[i]) restA.push(A[i]);
    for (j = 0; j < B.length; j++) if (!usedB[j]) restB.push(B[j]);
    var takenA = new Uint8Array(restA.length);
    restB.forEach(function (b) {
      var mi = -1, md = Infinity;
      restA.forEach(function (a, k) { if (!takenA[k] && a.str === b.str) { var q = d2(a, b); if (q < md) { md = q; mi = k; } } });
      if (mi >= 0) { takenA[mi] = 1; out.push({ type: '이동', a: restA[mi], b: b }); }
      else out.push({ type: '추가', a: null, b: b });
    });
    restA.forEach(function (a, k) { if (!takenA[k]) out.push({ type: '삭제', a: a, b: null }); });
    function pos(x) { var p = x.b || x.a; return p.y * 100000 + p.x; }
    out.sort(function (p, q) { return pos(p) - pos(q); });
    var counts = { 변경: 0, 추가: 0, 삭제: 0, 이동: 0 };
    out.forEach(function (x, k) { x.no = k + 1; counts[x.type]++; });
    return { list: out, counts: counts, same: same };
  }

  // BOM 시트(2차원 배열)에서 머리행을 찾아 표로 바꿉니다.
  // 수강생 BOM 양식(ERP 「정전개 입력 조회」): 1행 「회사명 : … / 품번 / 품명」, 2행 머리행(품목코드·품목명·BOM버전·규격·단위·수량·생산공정·위치·적요),
  // 마지막 행은 조회 일시. 머리행 위 제목에서 품번·품명을 읽어 둡니다(회사명은 버립니다).
  function parseBomSheet(aoa) {
    aoa = aoa || [];
    var hi = -1;
    for (var i = 0; i < Math.min(aoa.length, 15); i++) {
      var r = aoa[i] || [];
      if (r.some(function (c) { return KEY_HINTS.test(String(c == null ? '' : c)); }) && r.filter(function (c) { return !isBlank(c); }).length >= 2) { hi = i; break; }
    }
    if (hi < 0) hi = 0;
    var headers = (aoa[hi] || []).map(function (c, k) { return isBlank(c) ? '열' + (k + 1) : String(c).trim(); });
    var key = guessKeyColumn(headers), ki = headers.indexOf(key);
    var rows = [];
    for (var j = hi + 1; j < aoa.length; j++) {
      var line = aoa[j] || [];
      var kv = line[ki];
      if (isBlank(kv)) continue;
      var others = line.filter(function (c, k) { return k !== ki && !isBlank(c); }).length;
      if (!others && /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}/.test(String(kv).trim())) continue; // 조회 일시 줄
      var o = {};
      headers.forEach(function (hd, k) { o[hd] = line[k] == null ? '' : line[k]; });
      rows.push(o);
    }
    var title = '', partNo = '', partName = '';
    for (var t = 0; t < hi; t++) {
      var s = (aoa[t] || []).filter(function (c) { return !isBlank(c); }).join(' ');
      if (!s) continue;
      title = s;
      var parts = s.split('/').map(function (x) { return x.trim(); });
      var pn = parts.filter(function (x) { return /^[0-9A-Z][0-9A-Z-]{4,}$/i.test(x) && /\d/.test(x); })[0];
      if (pn) { partNo = pn; var at = parts.indexOf(pn); partName = parts.slice(at + 1).join(' / '); }
    }
    return { headers: headers, key: key, rows: rows, partNo: partNo, partName: partName, headerRow: hi + 1, hasTitle: !!title };
  }
  // 비교할 열 기본값: BOM 에서 뜻이 있는 칸만(위치·생산공정·BOM버전은 양식마다 메모성이라 기본으로 뺍니다 — 화면에서 켤 수 있음)
  var BOM_COMPARE_HINT = ['수량', '단위', '규격', '품목명', '품명', 'QTY', 'UNIT', 'SPEC'];
  // 비교에서 늘 빼는 열(2026-09-30 수강생 확정): 적요처럼 한쪽 BOM 에만 적어 두는 메모(예: 「위해작성」)는
  // 부품이 바뀐 것이 아니므로 비교하지 않습니다. 화면에서도 켤 수 없고, 비교 결과 표·엑셀에도 넣지 않습니다.
  var BOM_EXCLUDED_COL = /^(적요|비고|REMARKS?|NOTES?)$/i;
  function isExcludedBomCol(hd) { return BOM_EXCLUDED_COL.test(String(hd == null ? '' : hd).replace(/\s+/g, '')); }
  function defaultCompareCols(headers, key) {
    var ok = headers.filter(function (hd) { return hd !== key && !isExcludedBomCol(hd); });
    var c = ok.filter(function (hd) { return BOM_COMPARE_HINT.some(function (x) { return norm(hd) === norm(x); }); });
    return c.length ? c : ok;
  }
  // 고른 열에서 제외 열을 걸러 냅니다(예전에 저장된 선택·직접 넘긴 목록도)
  function bomCompareCols(cols) { return (cols || []).filter(function (c) { return !isExcludedBomCol(c); }); }

  // PDF 글자 정보(텍스트 층)가 쓸 만큼 있는지 판정합니다(2026-09-30 수강생 답: 「되는 것은 되고, 안 되는 것은 안 되게」).
  // CAD 가 글자를 선으로 그려 내보낸 PDF 는 글자 목록이 비거나, 쪽 번호·도면 밖 표기 몇 개만 있거나,
  // 글꼴 대응표가 없어 깨진 글자(□·사용자 정의 영역 문자)만 나옵니다. 이런 PDF 로 글자 비교를 하면
  // 반쯤만 맞는 결과가 나오므로 「글자 정보 없음」으로 보고 그림(선) 비교만 합니다.
  //  items = [{str}] 또는 문자열 배열. 결과 { has, count, readable, reason }
  var TEXT_LAYER_MIN = 5;           // 읽을 수 있는 글자 조각이 이보다 적으면(쪽 번호·도면 밖 표기 몇 개뿐) 도면 글자가 아닌 것으로 봄
  var TEXT_LAYER_MIN_SHARE = 0.6;   // 읽을 수 있는 조각의 몫이 이보다 낮으면 깨진 글자로 봄
  function textLayerInfo(items) {
    var list = (items || []).map(function (t) { return String(t && typeof t === 'object' ? t.str : t == null ? '' : t).trim(); }).filter(function (x) { return x !== ''; });
    var readable = list.filter(function (x) {
      if (/[\uFFFD\uE000-\uF8FF\u0000-\u001F]/.test(x)) return false;   // 깨진 글자·제어 문자
      return /[0-9A-Za-z\uAC00-\uD7A3]/.test(x);
    }).length;
    var n = list.length, has = readable >= TEXT_LAYER_MIN && readable >= n * TEXT_LAYER_MIN_SHARE;
    var reason = has ? '글자 정보 있음 (' + readable + '개)'
      : !n ? '글자 정보 없음 (글자를 선으로 그린 PDF)'
      : readable < TEXT_LAYER_MIN ? '글자 정보가 거의 없음 (' + readable + '개 — 도면 글자가 아닌 것으로 봄)'
      : '글자가 깨져 읽을 수 없음 (' + (n - readable) + '/' + n + '개)';
    return { has: has, count: n, readable: readable, reason: reason };
  }
  // 두 도면의 비교 방식: 둘 다 글자 정보가 있으면 글자 비교 + 선 비교, 하나라도 없으면 선(그림) 비교만.
  //  a·b = { kind: 'pdf'|'image', text: [...] } — 오류로 멈추지 않고, 무엇을 했는지 한 문장으로 알려 줍니다.
  function compareModeFor(a, b) {
    function side(x, k) {
      if (!x) return { k: k, has: false, why: '도면 없음' };
      if (x.kind !== 'pdf') return { k: k, has: false, why: '그림 파일(PNG·JPG)' };
      var inf = textLayerInfo(x.text);
      return { k: k, has: inf.has, why: inf.reason };
    }
    var A = side(a, 'A'), B = side(b, 'B');
    if (A.has && B.has) return { text: true, a: A, b: B, message: '두 도면 모두 PDF 글자 정보가 있어 글자 비교(T번호)와 선 비교를 함께 했습니다.' };
    var lack = [A, B].filter(function (x) { return !x.has; }).map(function (x) { return x.k + ' 도면은 ' + x.why; }).join(', ');
    return { text: false, a: A, b: B, message: lack + ' — 그래서 글자 비교는 건너뛰고 그림(선) 비교만 했습니다. 치수·품번 글자가 바뀐 곳도 선 모양이 달라지면 적색 상자로 잡힙니다.' };
  }
  // 편집 거리(작은 문자열용)
  function editDistance(a, b) {
    a = norm(a); b = norm(b);
    var m = a.length, n = b.length, prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  // 대체 후보: 삭제된 품번과 추가된 품번이 서로를 품거나(OPT-AB1234 → AB1234) 두 글자 안으로 다르면(1234567-2 → 1234657-2) 짝을 지어 줍니다.
  function replacementCandidates(res) {
    var del = res.rows.filter(function (r) { return r.status === '삭제'; });
    var add = res.rows.filter(function (r) { return r.status === '추가'; });
    var used = {}, out = [];
    del.forEach(function (d) {
      var ka = norm(d.key), best = null, bs = Infinity;
      add.forEach(function (a) {
        var kb = norm(a.key);
        if (used[kb]) return;
        var contain = ka.length >= 4 && kb.length >= 4 && (ka.indexOf(kb) >= 0 || kb.indexOf(ka) >= 0);
        var ed = editDistance(ka, kb);
        var sc = contain ? 0 : ed;
        // 짧은 품번끼리는 두 글자만 달라도 전혀 다른 부품이라, 길이의 1/4 까지만 봅니다(최대 2글자)
        var lim = Math.min(2, Math.floor(Math.min(ka.length, kb.length) / 4));
        if ((contain || (lim > 0 && ed <= lim)) && sc < bs) { bs = sc; best = a; }
      });
      if (best) { used[norm(best.key)] = 1; out.push({ from: d, to: best, reason: bs === 0 ? '품번을 품음' : '품번 ' + bs + '글자 다름' }); }
    });
    return out;
  }
  // BOM 차이 → ECN 변경자재 행. 대체 후보는 「대체」, 수량만 바뀌면 「수량변경」, 그 밖의 칸이 바뀌면 「사양변경」.
  function materialsFromDiff(res, cols) {
    cols = cols || {};
    var nameC = cols.name || '품목명', specC = cols.spec || '규격', qtyC = cols.qty || '수량', unitC = cols.unit || '단위';
    function spec(r) { return [r[nameC], r[specC]].filter(function (x) { return !isBlank(x); }).join(' / '); }
    var reps = replacementCandidates(res), inRep = {};
    reps.forEach(function (p) { inRep[p.from.key] = 1; inRep[p.to.key] = 1; });
    var out = [];
    res.rows.forEach(function (r) {
      if (r.status === '동일') return;
      if (r.status === '변경') {
        var onlyQty = r.changed.every(function (c) { return c === qtyC; });
        out.push({ type: onlyQty ? '수량변경' : '사양변경', location: '', beforeNo: r.key, beforeSpec: spec(r.a), beforeQty: r.a[qtyC], unit: r.b[unitC] || r.a[unitC] || '',
          afterNo: r.key, afterSpec: spec(r.b), afterQty: r.b[qtyC], stock: '', dept: '', currentStock: '' });
      } else if (r.status === '삭제' && !inRep[r.key]) {
        out.push({ type: '삭제', location: '', beforeNo: r.key, beforeSpec: spec(r.a), beforeQty: r.a[qtyC], unit: r.a[unitC] || '', afterNo: '', afterSpec: '', afterQty: '', stock: '', dept: '', currentStock: '' });
      } else if (r.status === '추가' && !inRep[r.key]) {
        out.push({ type: '신규', location: '', beforeNo: '', beforeSpec: '', beforeQty: '', unit: r.b[unitC] || '', afterNo: r.key, afterSpec: spec(r.b), afterQty: r.b[qtyC], stock: '', dept: '', currentStock: '' });
      }
    });
    reps.forEach(function (p) {
      out.push({ type: '대체', location: '', beforeNo: p.from.key, beforeSpec: spec(p.from.a), beforeQty: p.from.a[qtyC], unit: p.to.b[unitC] || p.from.a[unitC] || '',
        afterNo: p.to.key, afterSpec: spec(p.to.b), afterQty: p.to.b[qtyC], stock: '', dept: '', currentStock: '' });
    });
    return out;
  }

  // ── 제목란 읽기 (2026-09-29 저녁 「문의04」) ──────────────────────
  // 실제 도면 제목란은 「라벨(작은 글자) 옆이나 아래에 값(큰 글자)」 이 칸마다 따로 놓여 있어서,
  // 글자를 한 줄로 이어 붙여 라벨 뒤를 찾는 extractFields 로는 엉뚱한 값(다음 칸의 라벨)이 잡힙니다.
  // 여기서는 PDF 글자 조각의 위치(x·y·크기)로 라벨마다 가장 가까운 값을 고릅니다.
  // items = [{str, x, y, w, h}] — x = 글자 왼쪽, y = 글자 밑줄(위에서부터 잰 값), h = 글자 높이. pw·ph = 쪽 크기.
  // 확인한 양식: 두산밥캣코리아 제목란(MODEL · Rev. · NAME · NO. · 날짜) — 비교군 01 도면의 글자 정보로 확인.
  // HD현대 제목란(품번·품명·기종·명칭·NO.)은 받은 PDF 가 글자를 선으로 그려 글자 정보가 없어 라벨만 넣어 둔 가정입니다.
  var TB_LABELS = [
    { k: 'partNo', re: /^(?:DWG\.?\s*NO\.?|DRAWING\s*NO\.?|NO\.?|PART\s*NO\.?|PART\s*NUMBER|P\/N|도\s*번|품\s*번|도면\s*번호)$/i,
      ok: function (v) { return /\d/.test(v) && v.replace(/\s/g, '').length >= 5 && !isDateStr(v); } },
    { k: 'rev', re: /^(?:REV\.?|REVISION|REV\.?\s*NO\.?|개\s*정|개정\s*번호)$/i, ok: function (v) { return /^[A-Z0-9]{1,3}$/i.test(v); } },
    { k: 'partName', re: /^(?:PART\s*NAME|NAME|TITLE|DESCRIPTION|품\s*명|명\s*칭)$/i,
      ok: function (v) { return /[A-Z가-힣]{2,}/i.test(v) && !/^\d/.test(v) && !/CO\.?,?\s*LTD/i.test(v); } },
    { k: 'model', re: /^(?:MODEL|기\s*종|차\s*종)$/i, ok: function (v) { return /[A-Z0-9]/i.test(v) && v.length <= 24 && !isDateStr(v); } },
    { k: 'dwgDate', re: /^(?:DATE|DWG\.?\s*DATE|일\s*자|작성\s*일|도면\s*일자)$/i, ok: function (v) { return isDateStr(v); } }
  ];
  // 값이 아닌 라벨(칸 이름)들 — 값 후보에서 뺍니다
  var TB_OTHER = /^(?:MATERIAL|MAT\.?|MAT\s*NO\.?|QTY|Q'?TY|REMARKS?|SCALE|W\.?\s*T\.?|DIE\s*NO\.?|REF\.?\s*DWG|SHEET\s*#?|SHEETS?|WARNING|APPROVED|CHECKED|DRAWN|DESIGNED|재\s*질|수\s*량|비\s*고|척\s*도|개\s*수|중\s*량|소재\s*NO\.?|금형\s*NO\.?|관련\s*도면|[A-Z])$/i;
  function isDateStr(v) { return /^(?:\d{2}|\d{4})[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/.test(String(v).trim()); }
  function normDate(v) {
    var m = String(v).trim().match(/^(\d{2}|\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
    if (!m) return '';
    var y = m[1].length === 2 ? 2000 + +m[1] : +m[1];
    return y + '-' + pad(+m[2], 2) + '-' + pad(+m[3], 2);
  }
  // 회사명 → 고객사 이름(가정 — 기획서 11.2). 대문자·공백 무시로 찾습니다.
  var CUSTOMER_HINTS = [[/DOOSAN\s*BOBCAT/i, '두산밥캣코리아'], [/HD\s*HYUNDAI/i, 'HD현대'], [/HYUNDAI\s*(?:CONSTRUCTION|INFRACORE)/i, 'HD현대'], [/두산\s*밥캣/, '두산밥캣코리아'], [/HD\s*현대/, 'HD현대']];
  function customerFromText(text) {
    var t = String(text || '');
    for (var i = 0; i < CUSTOMER_HINTS.length; i++) if (CUSTOMER_HINTS[i][0].test(t)) return CUSTOMER_HINTS[i][1];
    return '';
  }
  function tbLabel(str) {
    for (var i = 0; i < TB_LABELS.length; i++) if (TB_LABELS[i].re.test(str)) return TB_LABELS[i];
    return null;
  }
  // 제목란 영역: 쪽의 오른쪽 아래(가로 45% 오른쪽 · 세로 55% 아래). 도면 안 표 머리(NO. · WIRE …)를 라벨로 잘못 잡지 않기 위해서입니다.
  function titleRegionItems(items, pw, ph) {
    return (items || []).filter(function (t) { return String(t.str || '').trim() && t.x + (t.w || 0) / 2 > pw * 0.45 && t.y > ph * 0.55; });
  }
  function titleBlockFields(items, pw, ph) {
    var all = (items || []).map(function (t) { return { str: String(t.str || '').replace(/\s+/g, ' ').trim(), x: t.x, y: t.y, w: t.w || 0, h: t.h || 8 }; })
      .filter(function (t) { return t.str; });
    var reg = pw && ph ? titleRegionItems(all, pw, ph) : all;
    var labels = [], values = [];
    reg.forEach(function (t) {
      var lb = tbLabel(t.str);
      if (lb) labels.push({ t: t, def: lb });
      else if (!TB_OTHER.test(t.str)) values.push(t);
    });
    // 라벨-값 짝마다 거리 점수(작을수록 가까움). 값 글자가 클수록(제목란 값은 라벨보다 큼) 점수를 줄여 줍니다.
    var pairs = [];
    labels.forEach(function (L0) {
      var l = L0.t, hl = l.h;
      values.forEach(function (v, vi) {
        if (!L0.def.ok(v.str)) return;
        var big = Math.min(3, Math.max(1, v.h / hl)), d = null;
        var gapX = v.x - (l.x + l.w);
        if (Math.abs(v.y - l.y) <= Math.max(l.h, v.h) * 0.9 && gapX >= -2 && gapX <= 12 * hl) d = Math.max(0, gapX);               // 오른쪽
        else if (v.y > l.y && v.y - l.y <= 5 * Math.max(hl, v.h) && v.x >= l.x - 3 * hl && v.x <= l.x + 25 * hl) d = (v.y - l.y) + 0.3 * Math.abs(v.x - l.x); // 아래
        if (d != null) pairs.push({ k: L0.def.k, v: vi, s: d / big, l: l });
      });
    });
    pairs.sort(function (a, b) { return a.s - b.s; });
    var out = {}, usedV = {}, at = {};
    pairs.forEach(function (p) {
      if (out[p.k] != null || usedV[p.v]) return;
      out[p.k] = values[p.v].str; usedV[p.v] = 1; at[p.k] = p;
    });
    // 품명은 두 줄(예: HARNESS / AIRCON - POWER)인 경우가 많아 바로 아래의 같은 크기 글자를 이어 붙입니다
    if (at.partName) {
      var cur = values[at.partName.v], parts = [cur.str], l = at.partName.l;
      for (var guard = 0; guard < 3; guard++) {
        var nx = null;
        values.forEach(function (v, vi) {
          if (usedV[vi] || v === cur) return;
          if (v.y > cur.y && v.y - cur.y <= 3 * cur.h && Math.abs(v.h - cur.h) <= cur.h * 0.25 && v.x >= l.x - 3 * l.h && v.x <= l.x + 25 * l.h &&
              /[A-Z가-힣]{2,}/i.test(v.str) && !/CO\.?,?\s*LTD/i.test(v.str) && (!nx || v.y < nx.v.y)) nx = { v: v, i: vi };
        });
        if (!nx) break;
        parts.push(nx.v.str); usedV[nx.i] = 1; cur = nx.v;
      }
      out.partName = parts.join(' ');
    }
    // 날짜 라벨이 없는 양식(두산 — D·F·C·H 칸 옆 날짜)은 제목란의 첫 날짜를 씁니다
    if (!out.dwgDate) {
      var ds = values.filter(function (v) { return isDateStr(v.str); }).sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      if (ds.length) out.dwgDate = ds[0].str;
    }
    if (out.dwgDate) out.dwgDate = normDate(out.dwgDate);
    var cust = customerFromText(reg.map(function (t) { return t.str; }).join(' '));
    if (cust) out.customer = cust;
    Object.keys(out).forEach(function (k) { if (isBlank(out[k])) delete out[k]; });
    return out;
  }

  // 파일명 규칙(수강생 실제 파일명 — 2026-09-29): 「999999-12345A MCV JOINT HARNESS - 260605.pdf」 · 「999999-12345_0001.pdf」 (품번은 가린 값)
  //  앞 품번(숫자6-숫자4~6 + 끝 영문 1자), 끝의 여섯 자리 날짜(YYMMDD), 가운데 낱말 = 품명 추정. _0001 같은 일련번호는 버립니다.
  //  품번 끝 영문 1자는 REV 로 추정합니다(15289 → 15289A = REV A, 수강생 캡처의 입력값과 같음). 모두 「파일명·추정」 표시.
  function fileNameFields(name) {
    var base = String(name || '').replace(/\.[^.]+$/, '').replace(/_\d{3,4}$/, '').trim(), out = {};
    var m = base.match(/^(\d{5,7}-\d{3,6})([A-Z])?(?![A-Z0-9])/i);
    if (!m) return out;
    out.partNo = m[1] + (m[2] || '').toUpperCase();
    if (m[2]) out.rev = m[2].toUpperCase();
    var rest = base.slice(m[0].length);
    var dm = rest.match(/[-_\s]+(\d{2})(\d{2})(\d{2})\s*$/);
    if (dm && +dm[2] >= 1 && +dm[2] <= 12 && +dm[3] >= 1 && +dm[3] <= 31) { out.dwgDate = '20' + dm[1] + '-' + dm[2] + '-' + dm[3]; rest = rest.slice(0, dm.index); }
    var nm = rest.replace(/[_]+/g, ' ').replace(/^[\s\-]+|[\s\-]+$/g, '').replace(/\s+/g, ' ');
    if (/[A-Z가-힣]{2,}/i.test(nm)) out.partName = nm;
    return out;
  }

  // 품번 끝 영문 1자 = REV (2026-09-30 오전 답 4 — CASE1 「999999-12345A 에서 A 가 REV」).
  // 끝이 숫자인 품번(영문이 붙지 않는 품번)은 REV 를 알 수 없으므로 빈 칸 — 사용자가 입력합니다.
  // 품번이 통째로 바뀌는 개정(CASE2)·전혀 다른 곳에 쓰는 경우(CASE3)는 품번 모양으로 가릴 수 없어 사람이 판단합니다.
  function revFromPartNo(partNo) {
    var m = String(partNo || '').trim().match(/^(?=.*\d.*\d.*\d)(.*\d)([A-Z])$/i);
    return m ? m[2].toUpperCase() : '';
  }

  // PDF 한 건에서 도면 정보 뽑기: 제목란(위치) > 글자 라벨(extractFields) > 파일명 순서로 채웁니다.
  // 돌려주는 source: title = 제목란, auto = 글자 라벨, file = 파일명, guess = 추정.
  function extractFromPdf(text, items, pw, ph, fileName, settings) {
    var ex = extractFields(text, '', settings), f = ex.fields, src = ex.source;
    var tb = items && items.length ? titleBlockFields(items, pw, ph) : {};
    if (Object.keys(tb).length) {
      // 제목란을 찾았으면 글자 라벨로 잡은 제목란 항목(품번·REV·품명·기종·고객사)은 믿지 않습니다 — 실제 도면에서 다음 칸 라벨이 잡혔습니다
      ['partNo', 'rev', 'partName', 'model', 'customer'].forEach(function (k) { if (src[k] === 'auto') { delete f[k]; delete src[k]; } });
    }
    Object.keys(tb).forEach(function (k) { f[k] = tb[k]; src[k] = 'title'; });
    // 사용처 라벨(APPLY 등)이 주기 문장에서 잡혀 긴 문장이 들어간 경우는 버립니다(실제 도면: 「APPLY THE RESIN TUBE …」)
    if (src.usage === 'auto' && String(f.usage || '').length > 20) { delete f.usage; delete src.usage; }
    if (!f.customer) { var c = customerFromText(text); if (c) { f.customer = c; src.customer = 'guess'; } }
    var fn = fileNameFields(fileName);
    if (!Object.keys(fn).length) {
      // 예전 규칙(예시 파일 HN-A0231_C.pdf → 품번 HN-A0231 · REV C)
      var old = extractFields('', fileName, settings).fields;
      if (old.partNo) fn.partNo = old.partNo;
      if (old.rev) fn.rev = old.rev;
    }
    Object.keys(fn).forEach(function (k) {
      if (isBlank(f[k])) { f[k] = fn[k]; src[k] = k === 'partNo' ? 'file' : 'guess'; }
    });
    // REV 가 제목란·파일명 어디에도 없으면 품번 끝 영문 1자(2026-09-30 답 4). 그것도 없으면 빈 칸 = 사용자 입력.
    if (isBlank(f.rev) && revFromPartNo(f.partNo)) { f.rev = revFromPartNo(f.partNo); src.rev = 'guess'; }
    // 사용처는 도면에 적혀 있지 않습니다(같은 답) — 자동으로 채우지 않고 사용자가 입력합니다.
    delete f.usage; delete src.usage;
    return { fields: f, source: src, missing: missingFields(f), title: tb };
  }

  // ── 하우징 → ASSY 자재 BOM 구성 (2026-09-29 저녁 「문의03」 · 2026-09-30 오전 답 1~3) ──────────
  // 마스터 표(하우징 품번 → 딸린 자재·수량)는 회사 자료라 도구에 들어 있지 않습니다. 사용자가 엑셀·CSV 로 불러옵니다.
  // 두 가지 형식을 받습니다.
  //  ① 도구 양식(한 줄 = 하우징 하나에 딸린 자재 하나) — 아래 낱말로 열을 찾습니다(parseHousingMaster).
  //  ② 회사 자재 DB 내보내기(시트 hsg_detail · hsg_pin_block · tml_detail … — 2026-09-30 수강생이 보낸 실제 구조, parseErpMaster).
  var HM_HEAD = {
    housing: /하우징|HOUSING|커넥터\s*품번|CONNECTOR/i,
    item: /자재\s*(?:품번|코드|번호)|구성\s*(?:품번|자재)|하위\s*품번|품목\s*코드|CHILD|COMPONENT|ASSY\s*자재|^\s*품번\s*$|PART\s*NO/i,
    name: /자재\s*명|품목\s*명|품\s*명|NAME|DESC/i,
    kind: /구분|종류|TYPE|KIND/i,
    qty: /수량|QTY|소요/i,
    unit: /단위|UNIT/i,
    basis: /기준|BASIS|PER/i,
    csa: /전선|CSA|SQ|굵기|WIRE|AWG/i,
    pinRange: /적용\s*핀|핀\s*범위|사용\s*핀|CAV\s*범위|PIN\s*RANGE/i,
    pins: /핀\s*수|극\s*수|CAVITY|CAV|PINS?/i,
    note: /비고|NOTE|REMARK|적요/i
  };
  function csaRange(v) {
    var s = String(v == null ? '' : v).replace(/SQ|MM2|㎟|mm²/gi, '').trim();
    if (!s) return null;
    var m = s.match(/^(\d+(?:\.\d+)?)\s*(?:~|-|–|to)\s*(\d+(?:\.\d+)?)$/i);
    if (m) return { min: +m[1], max: +m[2] };
    var n = toNum(s);
    return n == null ? null : { min: n, max: n };
  }
  // 「회로당」 = 쓰는 회로(전선) 하나에 하나씩 드는 자재(단자·씰), 「하우징당」 = 하우징 하나에 정해진 수(LOCK·캡),
  // 「빈 자리당」 = 하우징에서 쓰지 않는 자리(CAV) 하나에 하나씩 막는 자재(더미 플러그) — 2026-09-30 회사 DB 의 DUMMY
  function basisOf(v, kind) {
    var s = String(v || '') + ' ' + String(kind || '');
    if (/빈\s*자리|DUMMY|더미|미사용/i.test(String(v || ''))) return '빈 자리당';
    if (/회로|핀|CAV|CIRCUIT|PIN|WIRE|전선/i.test(String(v || ''))) return '회로당';
    if (/하우징|HOUSING|EA|개당/i.test(String(v || ''))) return '하우징당';
    if (/더미|DUMMY|빈\s*자리/i.test(s)) return '빈 자리당';
    return /단자|TERMINAL|CONTACT|SOCKET|PIN|씰|SEAL/i.test(s) ? '회로당' : '하우징당';
  }
  // 2차원 배열(엑셀 시트) → 마스터 행. 머리행은 위 10행 안에서 「하우징」 열과 「자재」 열이 함께 있는 행.
  // 하우징 칸이 비어 있으면 윗줄 하우징을 이어 씁니다(병합 셀로 만든 표).
  function parseHousingMaster(aoa) {
    aoa = aoa || [];
    var hi = -1, col = {};
    for (var r = 0; r < Math.min(10, aoa.length) && hi < 0; r++) {
      var row = (aoa[r] || []).map(function (x) { return String(x == null ? '' : x).trim(); }), c = {};
      row.forEach(function (hd, i) {
        if (!hd) return;
        Object.keys(HM_HEAD).forEach(function (k) {
          if (c[k] != null) return;
          if (k === 'item' && HM_HEAD.housing.test(hd)) return;   // 「하우징 품번」 을 자재 열로 잡지 않게
          if (k === 'name' && (HM_HEAD.housing.test(hd) || HM_HEAD.item.test(hd) && !/명/.test(hd))) return;
          if (k === 'pins' && (HM_HEAD.csa.test(hd) || HM_HEAD.pinRange.test(hd))) return;
          if (k === 'csa' && HM_HEAD.pinRange.test(hd)) return;
          if (HM_HEAD[k].test(hd)) c[k] = i;
        });
      });
      if (c.housing != null && c.item != null) { hi = r; col = c; }
    }
    if (hi < 0) return { rows: [], error: '머리행을 찾지 못했습니다 — 「하우징 품번」 열과 「자재 품번」 열이 있어야 합니다.' };
    var out = [], last = '';
    aoa.slice(hi + 1).forEach(function (row) {
      row = row || [];
      function g(k) { return col[k] == null ? '' : String(row[col[k]] == null ? '' : row[col[k]]).trim(); }
      var hs = g('housing') || last, item = g('item');
      if (!item) { if (g('housing')) last = g('housing'); return; }
      last = hs;
      var q = toNum(g('qty')), rg = csaRange(g('csa'));
      out.push({ housing: norm(hs), item: item, name: g('name'), kind: g('kind'), qty: q == null ? 1 : q, unit: g('unit') || 'EA',
        basis: basisOf(g('basis'), g('kind') + ' ' + g('name')), csaText: g('csa'), csaMin: rg ? rg.min : null, csaMax: rg ? rg.max : null,
        pins: toNum(g('pins')), note: g('note'), pinRange: pinRangeText(g('pinRange')), slot: '', optional: false });
    });
    return { rows: out, headerRow: hi + 1, columns: Object.keys(col) };
  }

  // ── 핀(CAV) 범위 ── 회사 DB 표기: '0' = 모든 핀, '2~7, 10~15, 17' = 그 핀들만
  function pinRangeText(v) {
    var s = String(v == null ? '' : v).trim();
    return !s || s === '0' || /^(?:ALL|전체)$/i.test(s) ? '' : s;
  }
  function pinRangeList(range) {
    var s = pinRangeText(range), out = [];
    if (!s) return null;
    s.split(/[,;]/).forEach(function (t) {
      t = t.trim();
      var m = t.match(/^(\d+)\s*(?:~|-|–)\s*(\d+)$/);
      if (m) out.push([+m[1], +m[2]]);
      else if (/^\d+$/.test(t)) out.push([+t, +t]);
      else if (t) out.push(t.toUpperCase());
    });
    return out.length ? out : null;
  }
  function pinRangeHas(range, cav) {
    var list = pinRangeList(range);
    if (!list) return true;
    var n = /^\d+$/.test(String(cav == null ? '' : cav).trim()) ? +String(cav).trim() : null;
    return list.some(function (r) { return typeof r === 'string' ? r === String(cav).trim().toUpperCase() : n != null && n >= r[0] && n <= r[1]; });
  }
  // 핀 번호 목록 → 짧은 범위 글자 [1,2,3,5] → '1~3, 5'
  function compactPins(nums) {
    var a = uniq(nums.map(Number).filter(function (n) { return !isNaN(n); })).sort(function (x, y) { return x - y; }), out = [];
    for (var i = 0; i < a.length; i++) {
      var j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      out.push(j > i ? a[i] + '~' + a[j] : String(a[i]));
      i = j;
    }
    return out.join(', ');
  }

  // ── 전선 굵기 (SQ · GA) ──────────────────────────
  // GA(AWG) → SQ 일반 환산값(가정). 회사 자재 DB 의 GA/SQ 환산표(ga_sq_conversion)를 불러오면 그 값을 먼저 씁니다.
  var GA_SQ_DEFAULT = { '26': 0.13, '24': 0.2, '22': 0.3, '20': 0.5, '18': 0.85, '16': 1.25, '14': 2, '12': 3, '10': 5, '8': 8, '6': 13, '4': 21, '2': 33, '1': 42, '1/0': 53 };
  function gaToSq(ga, table) {
    var k = String(ga == null ? '' : ga).trim().toUpperCase().replace(/^0+(?=\d)/, '');
    if (table && table[k] != null && toNum(table[k]) != null) return { sq: toNum(table[k]), src: '회사 환산표' };
    if (GA_SQ_DEFAULT[k] != null) return { sq: GA_SQ_DEFAULT[k], src: '일반 환산(가정)' };
    return null;
  }
  // 표 한 칸의 굵기 글자 → {text, sq, awg}. '18GA' · 'AWG 18' · '0.85' · '0.85SQ' · (머리가 GA 인 표의) '18'
  function gaugeValue(text, header, table) {
    var raw = String(text == null ? '' : text).trim(), s = raw.toUpperCase().replace(/\s+/g, '');
    if (!s) return null;
    var out = { text: raw, sq: null, awg: '' };
    var m = s.match(/^(\d{1,2}(?:\/0)?)(?:GA|AWG|G)$/) || s.match(/^(?:AWG|GA)(\d{1,2}(?:\/0)?)$/);
    if (!m && /^(?:GA|AWG|GAUGE)$/i.test(String(header || '').trim()) && /^\d{1,2}(?:\/0)?$/.test(s)) m = [s, s];
    if (m) {
      out.awg = m[1];
      var c = gaToSq(m[1], table);
      if (c) { out.sq = c.sq; out.conv = c.src; }
      return out;
    }
    var n = s.replace(/(?:SQ|MM2|MM²|㎟)$/, '');
    if (/^\d+(?:\.\d+)?$/.test(n)) out.sq = +n;
    return out;
  }
  function sqText(sq) { return sq == null ? '' : String(Math.round(sq * 1000) / 1000); }
  // GA/SQ 환산표 시트(열 ga · sq) → { '18': 0.85, … }
  function parseGaSq(aoa) {
    var rows = aoaObjects(aoa), out = {};
    rows.forEach(function (r) {
      var ga = String(r.ga == null ? '' : r.ga).trim().toUpperCase().replace(/^0+(?=\d)/, ''), sq = toNum(r.sq);
      if (ga && sq != null) out[ga] = sq;
    });
    return out;
  }

  // ── 도면의 CAV 표 읽기 (2026-09-30 오전 답 3 — 글자 정보가 있는 PDF 만) ──────────
  // 머리 낱말로 표를 찾습니다. CAV 표: CAV(PIN) · WIRE(CORE) · CSA(GA·SQ) [· COLOR], 전선표: NO · WIRE · GA · FROM · TO.
  // items = pdf.js 글자 조각 [{str, x, y, w, h}] (y 는 위에서부터 잰 밑줄). 두산 도면(비교군 01)의 「PIN CORE GA COLOR」 표로 확인했습니다.
  var WT_ROLES = [
    ['cav', /^(?:CAV\.?|CAVITY|CAV\.?\s*NO\.?|PIN|PIN\s*NO\.?|TERM(?:INAL)?\s*NO\.?|핀|핀\s*번호|극\s*번호)$/i],
    ['no', /^(?:NO\.?|번호)$/i],
    ['wire', /^(?:WIRE|WIRE\s*NO\.?|CORE|CIRCUIT|CIRCUIT\s*NO\.?|CKT|CIR\.?|회로|회로\s*번호|전선\s*번호|선\s*번)$/i],
    ['gauge', /^(?:CSA|CSA\s*\(?MM2?\)?|GA|AWG|SQ|SIZE|GAUGE|WIRE\s*SIZE|굵기|전선\s*굵기)$/i],
    ['color', /^(?:COLOU?R|CLR|색|색상)$/i],
    ['from', /^(?:FROM|시작)$/i],
    ['to', /^(?:TO|끝)$/i],
    ['type', /^(?:TYPE|SPEC|전선\s*종류)$/i]
  ];
  function wtRole(str) {
    for (var i = 0; i < WT_ROLES.length; i++) if (WT_ROLES[i][1].test(String(str).trim())) return WT_ROLES[i][0];
    return '';
  }
  function linesOf(list, tol) {
    var lines = [];
    list.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (t) {
      var l = lines[lines.length - 1];
      if (l && Math.abs(t.y - l.y) <= Math.max(l.h, t.h) * tol) l.items.push(t);
      else lines.push({ y: t.y, h: t.h, items: [t] });
    });
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }
  function parseWireTables(items, opt) {
    opt = opt || {};
    var all = (items || []).map(function (t, i) {
      var o = { str: String(t.str == null ? '' : t.str).replace(/\s+/g, ' ').trim(), x: +t.x || 0, y: +t.y || 0, w: +t.w || 0, h: +t.h || 8, i: i };
      o.role = wtRole(o.str); o.cx = o.x + o.w / 2;
      return o;
    }).filter(function (t) { return t.str; });
    var used = {}, out = [];
    all.forEach(function (g) {
      if (g.role !== 'gauge' || used[g.i]) return;
      var H = g.h;
      var line = all.filter(function (t) { return t.role && Math.abs(t.y - g.y) <= Math.max(g.h, t.h) * 0.6; }).sort(function (a, b) { return a.x - b.x; });
      var gi = line.indexOf(g), lo = gi, hi = gi;
      while (lo > 0 && line[lo].x - (line[lo - 1].x + line[lo - 1].w) <= 8 * H) lo--;
      while (hi < line.length - 1 && line[hi + 1].x - (line[hi].x + line[hi].w) <= 8 * H) hi++;
      var cl = line.slice(lo, hi + 1);
      cl.forEach(function (t) { used[t.i] = 1; });
      // 같은 줄에 표가 나란히 있으면(두산 도면: 커넥터 표 3개) 같은 머리가 다시 나오는 곳에서 끊습니다
      var segs = [], cur = [], seen = {};
      cl.forEach(function (t) {
        if (seen[t.role]) { segs.push(cur); cur = []; seen = {}; }
        cur.push(t); seen[t.role] = 1;
      });
      if (cur.length) segs.push(cur);
      segs.forEach(function (sg, k) {
        var roles = sg.map(function (t) { return t.role; });
        if (roles.indexOf('gauge') < 0) return;
        var kind = roles.indexOf('from') >= 0 || roles.indexOf('to') >= 0 ? 'wires' : 'cav';
        if (kind === 'cav' && roles.indexOf('cav') < 0 && roles.indexOf('no') < 0) return;
        if (kind === 'cav' && roles.indexOf('cav') < 0 && roles.indexOf('wire') < 0) return;   // NO · GA 만으로는 표로 보지 않음
        var prev = segs[k - 1], next = segs[k + 1];
        var leftLim = prev ? prev[prev.length - 1].x + prev[prev.length - 1].w + 0.5 * H : -Infinity;
        var rightLim = next ? next[0].x - 0.5 * H : Infinity;
        var t = readWireTable(all, sg, kind, leftLim, rightLim);
        if (t && t.rows.length) { if (opt.page) t.page = opt.page; out.push(t); }
      });
    });
    return out;
  }
  function readWireTable(all, sg, kind, leftLim, rightLim) {
    var H = Math.max.apply(null, sg.map(function (t) { return t.h; })), hy = Math.max.apply(null, sg.map(function (t) { return t.y; }));
    var hasCav = sg.some(function (t) { return t.role === 'cav'; });
    var cols = sg.map(function (t) { return { role: t.role === 'no' && kind === 'cav' && !hasCav ? 'cav' : t.role, head: t.str, x: t.x, r: t.x + t.w, cx: t.cx }; });
    cols.forEach(function (c, i) {
      c.lo = i ? (cols[i - 1].cx + c.cx) / 2 : Math.max(c.x - 1.2 * H, leftLim);   // 왼쪽 여유를 좁게 — 도면 테두리의 구역 글자(A·B …)를 줍지 않게
      c.hi = i < cols.length - 1 ? (c.cx + cols[i + 1].cx) / 2 : Math.min(c.r + 6 * H, rightLim);
    });
    var L0 = cols[0].lo, R0 = cols[cols.length - 1].hi, inSeg = {};
    sg.forEach(function (t) { inSeg[t.i] = 1; });
    var gHead = cols.filter(function (c) { return c.role === 'gauge'; })[0].head;
    var t = { kind: kind, name: '', housing: '', maker: '', gaugeHead: gHead, headers: cols.map(function (c) { return c.head; }), x: Math.round(L0), y: Math.round(hy), rows: [] };
    // 표 위 두 줄: 커넥터 이름(-AIRCON) · 하우징 품번과 메이커(HX-4P MAKER)
    var above = linesOf(all.filter(function (a) { return !inSeg[a.i] && a.y < hy - 0.3 * H && a.y >= hy - 4.5 * H && a.cx >= L0 - 2 * H && a.cx <= R0; }), 0.5).reverse();
    // 「-」 로 시작하는 줄 = 커넥터 이름, 숫자가 든 첫 조각 = 하우징 품번(뒤 조각은 메이커). 조각 안의 띄어쓰기는 품번의 일부로 둡니다(「FUSE 2F」 처럼).
    var loose = '';
    above.slice(0, 2).forEach(function (l) {
      var words = l.items.map(function (a) { return a.str; }), first = words[0] || '';
      if (/^-/.test(first)) { if (!t.name) t.name = words.join(' ').replace(/^-+\s*/, ''); }
      else if (!t.housing && /\d/.test(first) && first.replace(/\s/g, '').length >= 3 && first.length <= 40) { t.housing = first; t.maker = words.slice(1).join(' '); }
      else if (!loose) loose = words.join(' ');
    });
    if (!t.name && kind === 'cav' && loose) t.name = loose;
    var below = linesOf(all.filter(function (a) { return !inSeg[a.i] && a.y > hy + 0.3 * H && a.y <= hy + 150 * H && a.cx >= L0 && a.cx <= R0; }), 0.5);
    var prevY = hy, pitch = null;
    for (var li = 0; li < below.length; li++) {
      var l = below[li], gap = l.y - prevY;
      if (!t.rows.length && gap > 3.5 * H) break;
      if (t.rows.length && gap > (pitch ? Math.max(1.6 * pitch, 1.2 * H) : 2.6 * H)) break;   // 표 줄 간격은 고르므로 간격이 벌어지면 표 끝
      if (l.items.filter(function (a) { return a.role; }).length >= 2) break;    // 다음 표의 머리
      if (/^-/.test(l.items[0].str)) break;                                      // 다음 표의 커넥터 이름
      var cells = {};
      l.items.forEach(function (a) {
        var c = cols.filter(function (c0) { return a.cx >= c0.lo && a.cx < c0.hi; })[0];
        if (c) cells[c.role] = cells[c.role] ? cells[c.role] + ' ' + a.str : a.str;
      });
      if (!cells.cav && !cells.no && !cells.wire && !cells.gauge) break;
      if (kind === 'cav' && cells.cav && !/^[A-Z]{0,2}\d{1,3}[A-Z]?$/i.test(cells.cav)) break;
      if (t.rows.length === 1 && pitch == null) pitch = gap;
      var r = kind === 'cav' ? { cav: cells.cav || '', wire: cells.wire || '', gauge: cells.gauge || '', color: cells.color || '' }
        : { no: cells.no || '', wire: cells.wire || '', gauge: cells.gauge || '', color: cells.color || '', type: cells.type || '', from: cells.from || '', to: cells.to || '' };
      t.rows.push(r);
      prevY = l.y;
      if (t.rows.length >= 300) break;
    }
    return t;
  }
  // 여러 쪽: pages = [{items}] → 표 목록(쪽 번호 붙임)
  function parseWireTablesPages(pages) {
    var out = [];
    (pages || []).forEach(function (p, i) { parseWireTables(p.items || p, { page: i + 1 }).forEach(function (t) { out.push(t); }); });
    return out;
  }
  function connKey(s) { return String(s == null ? '' : s).toUpperCase().replace(/^-+/, '').replace(/\s+/g, ''); }

  // CAV 표의 굵기와 도면의 다른 곳(다른 끝의 CAV 표 · 전선표)에 적힌 굵기 비교 — 첫 판(2026-09-30)
  //  ① 같은 전선 번호가 여러 표에 나오면 굵기가 모두 같은지
  //  ② 전선표의 FROM · TO 「COND(4)」 → COND 커넥터 표 4번 자리의 전선 번호가 같은지
  function gaugeCheck(tables, gaSq) {
    var byWire = {}, order = [], cav = {}, mism = [], nCav = 0, nWire = 0;
    function gk(text, head) { var v = gaugeValue(text, head, gaSq); return !v ? '' : v.sq != null ? 'SQ ' + sqText(v.sq) : norm(v.text); }
    function add(wire, e) {
      var w = norm(wire); if (!w) return;
      if (!byWire[w]) { byWire[w] = []; order.push(w); }
      byWire[w].push(e);
    }
    (tables || []).forEach(function (t) {
      if (t.kind !== 'cav') return;
      nCav++;
      var nm = t.name || t.housing || 'CAV 표';
      cav[connKey(t.name)] = cav[connKey(t.name)] || {};
      t.rows.forEach(function (r) {
        cav[connKey(t.name)][norm(r.cav)] = { r: r, t: t };
        if (r.wire || r.gauge) add(r.wire, { where: nm + ' ' + r.cav + '번', gauge: r.gauge, g: gk(r.gauge, t.gaugeHead) });
      });
    });
    (tables || []).forEach(function (t) {
      if (t.kind !== 'wires') return;
      nWire++;
      t.rows.forEach(function (r) {
        var where = '전선표 ' + (r.no ? r.no + '행 ' : '') + '(' + (r.from || '?') + ' → ' + (r.to || '?') + ')';
        add(r.wire, { where: where, gauge: r.gauge, g: gk(r.gauge, t.gaugeHead) });
        [r.from, r.to].forEach(function (end) {
          var m = String(end || '').match(/^(.+?)\s*\(\s*([A-Z]{0,2}\d{1,3}[A-Z]?)\s*\)$/i);
          if (!m) return;
          var c = (cav[connKey(m[1])] || {})[norm(m[2])];
          if (!c) return;
          if (r.wire && c.r.wire && norm(r.wire) !== norm(c.r.wire)) {
            mism.push({ kind: '전선 번호 다름', wire: r.wire, entries: [{ where: where, value: r.wire }, { where: (c.t.name || c.t.housing) + ' ' + c.r.cav + '번', value: c.r.wire }] });
          } else if (!r.wire) {
            var a = gk(r.gauge, t.gaugeHead), b = gk(c.r.gauge, c.t.gaugeHead);
            if (a && b && a !== b) mism.push({ kind: '굵기 다름', wire: '', entries: [{ where: where, value: r.gauge }, { where: (c.t.name || c.t.housing) + ' ' + c.r.cav + '번', value: c.r.gauge }] });
          }
        });
      });
    });
    var compared = 0;
    order.forEach(function (w) {
      var es = byWire[w].filter(function (e) { return e.g; });
      if (es.length < 2) return;
      compared++;
      if (uniq(es.map(function (e) { return e.g; })).length > 1) mism.push({ kind: '굵기 다름', wire: w, entries: es.map(function (e) { return { where: e.where, value: e.gauge }; }) });
    });
    return { cavTables: nCav, wireTables: nWire, wires: order.length, compared: compared, mismatches: mism };
  }

  // ── 회사 자재 DB 내보내기 읽기 (2026-09-30 오전 답 1 — 「회사 자재 DB 구축을 위한 자료」 표본의 열 구성) ──────────
  // 시트 이름·열 이름을 그대로 찾습니다(자동 맞춤). 하우징 한 종 = hsg_detail 한 행(회사별).
  //   hsg_detail(hsg_item · no_pins · lock_sn · lock_add_sn · cap_sn · hsg_match_sn · opt_sn · use_hsg)
  //   └ hsg_pin_block(pin_range · block_type TML/SEAL/DUMMY · sub_item)   ← 있으면 이것을 씀
  //   └ hsg_pin(pin_row · tml_gid · seal_gid · dummy_sn) + sub_group_id_item_link  ← 블록이 없는 하우징
  //   └ hsg_cover(cover_item) · hsg_etc_add_link_detail(etc_add_item · qty · required · remark)
  //   tml_detail · seal_detail(sq_min · sq_max) = 단자·씰이 맞는 전선 굵기 범위, ga_sq_conversion = GA → SQ
  var ERP_SHEETS = ['item', 'hsg_detail', 'hsg_pin', 'hsg_pin_block', 'hsg_cover', 'hsg_etc_add_link_detail',
    'sub_group_id_item_link', 'tml_detail', 'seal_detail', 'ga_sq_conversion', 'sub_remark'];
  function aoaObjects(aoa) {
    if (!aoa || !aoa.length) return [];
    var h = (aoa[0] || []).map(function (x) { return String(x == null ? '' : x).trim().toLowerCase(); });
    return aoa.slice(1).map(function (r) {
      var o = {};
      h.forEach(function (k, i) { if (k) o[k] = r && r[i] != null ? String(r[i]).trim() : ''; });
      return o;
    });
  }
  function isErpMasterBook(sheetNames) { return (sheetNames || []).some(function (n) { return /^hsg_detail$/i.test(String(n).trim()); }); }
  function erpSheet(book, name) {
    var k = Object.keys(book || {}).filter(function (n) { return n.trim().toLowerCase() === name; })[0];
    return k ? aoaObjects(book[k]) : [];
  }
  function groupBy(list, key) {
    var m = {};
    list.forEach(function (r) { var k = r[key]; if (k == null || k === '') return; (m[k] || (m[k] = [])).push(r); });
    return m;
  }
  function erpCompanies(book) {
    var c = {};
    erpSheet(book, 'hsg_detail').forEach(function (d) { var k = d.company || ''; c[k] = (c[k] || 0) + 1; });
    return c;
  }
  function parseErpMaster(book, opt) {
    opt = opt || {};
    var D = erpSheet(book, 'hsg_detail');
    if (!D.length || !('hsg_item' in D[0])) return { rows: [], info: {}, gaSq: {}, error: 'hsg_detail 시트에 hsg_item 열이 없습니다.' };
    var comps = erpCompanies(book);
    var company = opt.company != null ? opt.company : Object.keys(comps).sort(function (a, b) { return comps[b] - comps[a]; })[0];
    var items = {};
    erpSheet(book, 'item').forEach(function (r) { if (r.item_code) items[norm(r.item_code)] = { name: r.item_name || '', group: r.item_group || '' }; });
    function nameOf(code) { var it = items[norm(code)]; return !it ? '' : it.name && norm(it.name) !== norm(code) ? it.name : it.group; }
    function byCo(list, codeKey) { var m = {}; list.forEach(function (r) { if (r[codeKey]) m[(r.company || '') + '|' + norm(r[codeKey])] = r; }); return m; }
    var tml = byCo(erpSheet(book, 'tml_detail'), 'tml_item'), seal = byCo(erpSheet(book, 'seal_detail'), 'seal_item');
    function sqOf(map, code) {
      var r = map[company + '|' + norm(code)] || map['|' + norm(code)];
      if (!r) return null;
      var a = toNum(r.sq_min), b = toNum(r.sq_max);
      if (a == null || b == null || (a === 0 && b === 0)) return null;
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    var P = groupBy(erpSheet(book, 'hsg_pin'), 'parent'), B = groupBy(erpSheet(book, 'hsg_pin_block'), 'parent');
    var C = groupBy(erpSheet(book, 'hsg_cover'), 'parent'), E = groupBy(erpSheet(book, 'hsg_etc_add_link_detail'), 'parent');
    var G = groupBy(erpSheet(book, 'sub_group_id_item_link'), 'parent');
    var SR = {};
    erpSheet(book, 'sub_remark').forEach(function (r) { if (!r.company || r.company === company) SR[norm(r.hsg_item) + '|' + norm(r.sub_item)] = r.sub_remark || ''; });
    var gaSq = parseGaSq((function () { var k = Object.keys(book || {}).filter(function (n) { return n.trim().toLowerCase() === 'ga_sq_conversion'; })[0]; return k ? book[k] : []; })());
    var rows = [], info = {}, st = { details: D.length, company: company, companies: comps, housings: 0, otherCompany: 0, fromBlocks: 0, fromPins: 0, noChildren: 0,
      terminals: 0, terminalsWithSq: 0, seals: 0, sealsWithSq: 0, byKind: {}, gaSq: Object.keys(gaSq).length };
    D.forEach(function (d) {
      if ((d.company || '') !== company) { st.otherCompany++; return; }
      var hs = norm(d.hsg_item);
      if (!hs) return;
      var pins = toNum(d.no_pins);
      info[hs] = { pins: pins || null, series: d.series_name || '', cap: d.cap_sn || '', match: d.hsg_match_sn || '', opt: d.opt_sn || '', use: d.use_hsg !== '0' };
      st.housings++;
      var n0 = rows.length, seen = {};
      function add(kind, item, basis, o) {
        item = String(item == null ? '' : item).trim();
        if (!item) return;
        o = o || {};
        var k = kind + '|' + (o.pinRange || '') + '|' + norm(item);
        if (seen[k]) return;
        seen[k] = 1;
        var rg = o.range;
        rows.push({ housing: hs, item: item, name: nameOf(item), kind: kind, qty: o.qty == null ? 1 : o.qty, unit: 'EA', basis: basis,
          csaText: rg ? sqText(rg.min) + '~' + sqText(rg.max) : '', csaMin: rg ? rg.min : null, csaMax: rg ? rg.max : null, pins: pins || null,
          note: o.note || '', pinRange: o.pinRange || '', slot: o.slot || '', optional: !!o.optional });
        st.byKind[kind] = (st.byKind[kind] || 0) + 1;
        if (kind === '단자') { st.terminals++; if (rg) st.terminalsWithSq++; }
        if (kind === '씰') { st.seals++; if (rg) st.sealsWithSq++; }
      }
      add('LOCK', d.lock_sn, '하우징당');
      add('LOCK 추가', d.lock_add_sn, '하우징당');
      // 캡 · 옵션 품번은 BOM 에 넣습니다(2026-09-30 오후 수강생 답 ③). 짝 하우징은 참고로 보여 주고 사용자가 고를 때만 넣음
      itemList(d.cap_sn).forEach(function (c) { add('캡', c, '하우징당'); });
      itemList(d.opt_sn).forEach(function (c) { add('옵션', c, '하우징당'); });
      (C[d.name] || []).forEach(function (c) { add('커버', c.cover_item, '하우징당'); });
      (E[d.name] || []).forEach(function (e) { add('부가 자재', e.etc_add_item, '하우징당', { qty: toNum(e.qty) || 1, note: e.remark || '', optional: e.required === '0' }); });
      var bl = (B[d.name] || []).slice().sort(function (a, b) { return N(a.idx) - N(b.idx); });
      if (bl.length) {
        st.fromBlocks++;
        bl.forEach(function (b) {
          var t = String(b.block_type || '').toUpperCase(), pr = pinRangeText(b.pin_range), note = b.sub_remark || SR[hs + '|' + norm(b.sub_item)] || '';
          if (t === 'TML') add('단자', b.sub_item, '회로당', { range: sqOf(tml, b.sub_item), pinRange: pr, slot: 'TML|' + pr, note: note });
          else if (t === 'SEAL') add('씰', b.sub_item, '회로당', { range: sqOf(seal, b.sub_item), pinRange: pr, slot: 'SEAL|' + pr, note: note });
          else if (t === 'DUMMY') add('더미(빈 자리)', b.sub_item, '빈 자리당', { pinRange: pr, slot: 'DUMMY|' + pr, note: note });
        });
      } else if ((P[d.name] || []).length) {
        st.fromPins++;
        // 핀마다 한 행이라 같은 조합(단자 그룹 · 씰 그룹 · 더미)을 묶어 핀 범위로 줄입니다
        var combos = {}, corder = [];
        P[d.name].forEach(function (p) {
          var k = [p.tml_gid, p.seal_gid, p.dummy_sn].join('|');
          if (!combos[k]) { combos[k] = { p: p, pins: [], all: false }; corder.push(k); }
          if (pinRangeText(p.pin_row) === '') combos[k].all = true; else combos[k].pins.push(p.pin_row);
        });
        corder.forEach(function (k) {
          var c = combos[k], p = c.p, pr = c.all ? '' : compactPins(c.pins);
          (G[p.tml_gid] || []).forEach(function (l) { add('단자', l.sub_group_item, '회로당', { range: sqOf(tml, l.sub_group_item), pinRange: pr, slot: 'TML|' + pr, note: SR[hs + '|' + norm(l.sub_group_item)] || '' }); });
          (G[p.seal_gid] || []).forEach(function (l) { add('씰', l.sub_group_item, '회로당', { range: sqOf(seal, l.sub_group_item), pinRange: pr, slot: 'SEAL|' + pr }); });
          add('더미(빈 자리)', p.dummy_sn, '빈 자리당', { pinRange: pr, slot: 'DUMMY|' + pr });
        });
      }
      if (rows.length === n0) st.noChildren++;
    });
    st.rows = rows.length;
    return { rows: rows, info: info, gaSq: gaSq, company: company, stats: st, error: st.housings ? '' : '고른 회사(' + company + ')의 하우징이 없습니다.' };
  }

  // 한 칸에 품번이 여럿 적힌 경우(쉼표 · 세미콜론 · 줄바꿈)를 나눕니다. 대소문자는 그대로 둡니다
  function itemList(v) { return String(v == null ? '' : v).split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  // 예전에 불러온 마스터(캡 · 옵션 행이 없던 때)도 하우징 정보(info.cap · opt)로 캡 · 옵션 행을 채웁니다
  function capOptRows(hs, inf, kids) {
    var out = [];
    if (!inf) return out;
    [['캡', inf.cap], ['옵션', inf.opt]].forEach(function (x) {
      if (kids.some(function (r) { return r.kind === x[0]; })) return;
      itemList(x[1]).forEach(function (c) { out.push({ housing: hs, item: c, name: '', kind: x[0], qty: 1, unit: 'EA', basis: '하우징당', csaText: '', csaMin: null, csaMax: null, pins: null, note: '', pinRange: '', slot: '', optional: false }); });
    });
    return out;
  }
  // 짝 하우징 후보(참고용) — 사용자가 하나를 고르면 BOM 에 넣습니다(2026-09-30 오후 답 ③)
  function matingOptions(housing, info) {
    var inf = (info || {})[norm(housing)];
    return inf ? itemList(inf.match) : [];
  }
  // 도면 품번과 「비슷한」 자재 DB 품번 — 뒤에 꼬리(-5 · _A · 공백 뒤 글자)만 더 붙은 것, 또는 도면 쪽에 꼬리가 더 붙은 것.
  // 같은 하우징으로 자동 처리하지 않습니다(2026-09-30 오후 답 ①: 서로 다른 품번으로 보고 선택창에서 사용자가 고름).
  function nearHousings(h, keys) {
    h = norm(h);
    if (!h) return [];
    return (keys || []).filter(function (k) {
      if (k === h) return false;
      return (k.indexOf(h) === 0 && /^[-_ ]/.test(k.slice(h.length))) || (h.indexOf(k) === 0 && /^[-_ ]/.test(h.slice(k.length)));
    }).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); }).slice(0, 8);
  }
  // CAV 표가 있는 쪽 번호들(여러 장 도면의 쪽 고르기용)
  function cavPages(tables) {
    return uniq((tables || []).map(function (t) { return t.page || 1; })).sort(function (a, b) { return a - b; });
  }
  // 쪽 고르기: page 가 숫자면 그 쪽 표만, 'all' · 빈 값이면 모든 쪽(2026-09-30 오후 답 ⑤ 「전체 페이지」)
  function tablesOnPage(tables, page) {
    if (page == null || page === '' || page === 'all') return tables || [];
    return (tables || []).filter(function (t) { return (t.page || 1) === +page; });
  }
  // 도면 비교에서 A · B 의 쪽 고르기 → 비교할 쪽 쌍 [[A쪽, B쪽], …] (없는 쪽은 null)
  //  둘 다 전체 = 같은 쪽 번호끼리(쪽 수가 다르면 남는 쪽은 상대가 null), 한쪽만 전체 = 고른 한 쪽을 상대의 모든 쪽과
  function pagePairs(nA, selA, nB, selB) {
    nA = Math.max(1, toNum(nA) || 1); nB = Math.max(1, toNum(nB) || 1);
    var allA = selA === 'all', allB = selB === 'all', pA = Math.min(nA, Math.max(1, toNum(selA) || 1)), pB = Math.min(nB, Math.max(1, toNum(selB) || 1)), out = [], i;
    if (allA && allB) for (i = 1; i <= Math.max(nA, nB); i++) out.push([i <= nA ? i : null, i <= nB ? i : null]);
    else if (allA) for (i = 1; i <= nA; i++) out.push([i, pB]);
    else if (allB) for (i = 1; i <= nB; i++) out.push([pA, i]);
    else out.push([pA, pB]);
    return out;
  }
  // 전체 페이지 비교 요약(엑셀) — sums = [{pa, pb, add, del, moved, text:{변경,추가,삭제,이동}|null, align, note}]
  function sheetPageSummary(sums, partA, partB) {
    var rows = [['A품번', partA || '', 'B품번', partB || ''], ['A 쪽', 'B 쪽', '적색(B에만)', '파랑(A에만)', '이동(보라)', '글자 변경', '글자 추가', '글자 삭제', '판정', '정렬 · 비고']];
    (sums || []).forEach(function (x) {
      var t = x.text, n = x.pa == null || x.pb == null ? null : x.add + x.del + (t ? t.변경 + t.추가 + t.삭제 : 0);
      rows.push([x.pa == null ? '(없음)' : x.pa, x.pb == null ? '(없음)' : x.pb, x.pa == null || x.pb == null ? '' : x.add, x.pa == null || x.pb == null ? '' : x.del, x.pa == null || x.pb == null ? '' : x.moved,
        t ? t.변경 : '', t ? t.추가 : '', t ? t.삭제 : '', n == null ? (x.pa == null ? 'A 에 없는 쪽' : 'B 에 없는 쪽') : n ? '차이 있음' : '차이 없음', x.note || x.align || '']);
    });
    return rows;
  }

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function masterKeys(master, info) {
    return uniq((master || []).map(function (r) { return r.housing; }).concat(Object.keys(info || {})));
  }
  // 도면 글자·주요 커넥터 칸에서 마스터에 있는 하우징 품번을 찾아 개수를 셉니다.
  // 품번 안의 하이픈 앞뒤 공백은 무시합니다(PDF 글자가 「DT06 - 2S」 처럼 떨어져 나오는 경우).
  function findHousings(text, connectors, master, info) {
    var keys = masterKeys(master, info), up = String(text || '').toUpperCase(), list = splitList(connectors), out = [];
    keys.forEach(function (k) {
      var re = new RegExp('(?:^|[^A-Z0-9])' + escRe(k).replace(/\\-|-/g, '\\s*-\\s*') + '(?![A-Z0-9])', 'g'), n = 0;
      while (re.exec(up)) n++;
      if (n) out.push({ housing: k, count: n, from: '도면 글자' });
      else if (list.indexOf(k) >= 0) out.push({ housing: k, count: 1, from: '주요 커넥터 칸' });
    });
    return out;
  }
  // 도면의 CAV 표 → 하우징별 실제 커넥터(표 하나 = 커넥터 하나). 마스터에 없는 하우징은 missing 으로(비슷한 품번 함께).
  //  opt.picks = { 도면 품번: 고른 자재 DB 품번 | '' (고르지 않음) } — 비슷한 품번 선택창에서 사용자가 고른 값(2026-09-30 오후 답 ①)
  //  opt.page  = 쪽 번호 | 'all'(전체 페이지, 기본)
  // missing: [{name, housing, near, page, skipped}] — near 가 있고 아직 고르지 않은 것은 선택창에 나옵니다(needPick)
  function housingsFromCavTables(tables, master, info, opt) {
    opt = opt || {};
    var keys = masterKeys(master, info), has = {}, out = [], miss = [], picks = opt.picks || {};
    keys.forEach(function (k) { has[k] = 1; });
    tablesOnPage(tables, opt.page).forEach(function (t) {
      if (t.kind !== 'cav') return;
      var h = norm(t.housing), use = h, drawn = '';
      if (!h || !has[h]) {
        var pk = h && Object.prototype.hasOwnProperty.call(picks, h) ? norm(picks[h]) : null;
        if (pk && has[pk]) { use = pk; drawn = h; }
        else {
          miss.push({ name: t.name || '', housing: h, near: nearHousings(h, keys), page: t.page || 1, skipped: pk === '' });
          return;
        }
      }
      var f = out.filter(function (x) { return x.housing === use; })[0];
      if (!f) { f = { housing: use, count: 0, from: 'CAV 표', instances: [] }; out.push(f); }
      if (drawn && (!f.drawn || f.drawn.indexOf(drawn) < 0)) f.drawn = (f.drawn || []).concat([drawn]);
      f.count++;
      f.instances.push({ name: t.name || '', page: t.page || 1, drawn: drawn, gaugeHead: t.gaugeHead || '', cavs: t.rows.map(function (r) { return { cav: r.cav, wire: r.wire, gauge: r.gauge, used: !!(r.wire || r.gauge) }; }) });
    });
    return { found: out, missing: miss, needPick: miss.filter(function (x) { return x.near.length && !x.skipped; }) };
  }
  // 직접 넣는 「사용 핀:굵기」 — '1:0.5, 2:18GA, 4~6:1.25, 3' (굵기 없는 핀은 굵기 모름)
  function parseCavSpec(text) {
    var out = [];
    String(text || '').split(/[,;\n]/).forEach(function (tok) {
      tok = tok.trim();
      if (!tok) return;
      var m = tok.match(/^([A-Z]{0,2}\d{1,3}[A-Z]?)(?:\s*[~\-–]\s*(\d{1,3}))?\s*(?:[:=]\s*(.+))?$/i);
      if (!m) return;
      var g = (m[3] || '').trim();
      if (m[2] && /^\d+$/.test(m[1])) for (var i = +m[1]; i <= +m[2] && i - +m[1] < 200; i++) out.push({ cav: String(i), gauge: g, used: true });
      else out.push({ cav: m[1].toUpperCase(), gauge: g, used: true });
    });
    return out;
  }
  // 하우징 한 개의 핀 수 기본값: 회사 DB 의 no_pins → 마스터의 핀 수 열 → 품번 모양(-2S · -12P)에서 추정 → 없으면 1
  function housingPins(housing, master, info) {
    var inf = (info || {})[norm(housing)];
    if (inf && inf.pins) return inf.pins;
    var r = (master || []).filter(function (x) { return x.housing === norm(housing) && x.pins; })[0];
    if (r) return r.pins;
    var m = String(housing).match(/-(\d{1,2})[SP](?![0-9])/i);
    return m ? +m[1] : 1;
  }
  // BOM 펼치기.
  //  found = [{housing, count, from, (instances | cavSpec | circuits·csa)}]
  //   instances = CAV 표에서 읽은 커넥터들 [{name, gaugeHead, cavs:[{cav, wire, gauge, used}]}] — 가장 정확
  //   cavSpec   = 직접 넣은 「사용 핀:굵기」 (count 개 모두 같다고 봄)
  //   circuits·csa = 예전 방식(회로 수 · 한 가지 굵기) — 핀 번호를 모르면 1번부터 차례로 쓴다고 봅니다
  //  opt = {merge, info, gaSq}
  // 단자·씰(회로당)은 **쓰는 회로(전선이 있는 자리)만** 셉니다(2026-09-30 답 2). 같은 자리의 후보가 굵기 범위로 나뉘어 있으면
  // 회로마다 그 전선 굵기가 들어가는 후보 하나를 고릅니다(범위가 가장 좁은 것). 쓰지 않는 자리는 더미(빈 자리당)로 셉니다.
  // 돌려주는 rows: [{출처, 하우징, 품목코드, 품목명, 구분, 수량, 단위, 근거, 확인}] — 하우징 행 다음에 딸린 자재 행.
  function expandHousingBom(found, master, opt) {
    opt = opt || {};
    master = master || [];
    var info = opt.info || {}, gaSq = opt.gaSq, rows = [];
    (found || []).forEach(function (f) {
      var hs = norm(f.housing), kids = master.filter(function (r) { return r.housing === hs; }), inf = info[hs];
      kids = kids.concat(capOptRows(hs, inf, kids));
      var pinsN = housingPins(hs, master, info), insts = [], total = 0;
      function circ(list, head) {
        return list.map(function (c) { var v = gaugeValue(c.gauge, head, gaSq); return { cav: String(c.cav == null ? '' : c.cav).trim(), sq: v ? v.sq : null, text: c.gauge || '', used: c.used !== false }; });
      }
      if (f.instances && f.instances.length) {
        f.instances.forEach(function (i) { insts.push({ name: i.name, mult: 1, cavs: circ(i.cavs || [], i.gaugeHead), known: true }); });
      } else {
        var cnt = toNum(f.count) || 0, spec = parseCavSpec(f.cavSpec);
        if (spec.length) insts.push({ mult: cnt, cavs: circ(spec, ''), known: true });
        else {
          var cir = toNum(f.circuits);
          if (cir == null) cir = pinsN;
          var cs = [];
          for (var i = 0; i < cir && i < 500; i++) cs.push({ cav: String(i + 1), gauge: f.csa == null ? '' : String(f.csa), used: true });
          insts.push({ mult: cnt, cavs: circ(cs, ''), known: false });
        }
      }
      insts.forEach(function (x) { total += x.mult; });
      var hsChk = !kids.length ? (inf ? '회사 DB 에 이 하우징의 딸린 자재가 없습니다' : '마스터에 없음 — 딸린 자재를 불러오지 못했습니다') : (inf && inf.use === false ? '회사 DB 에서 사용 안 함(use_hsg 0)으로 표시된 하우징' : '');
      var nUsed = 0;
      insts.forEach(function (x) { nUsed += x.cavs.filter(function (c) { return c.used; }).length * x.mult; });
      rows.push({ 출처: f.from || '도면', 하우징: hs, 품목코드: hs, 품목명: '', 구분: '하우징', 수량: total, 단위: 'EA',
        근거: (f.from === '직접 입력' ? '직접 입력 ' : f.from === 'CAV 표' ? 'CAV 표 ' : '도면에서 ') + total + '곳 · 쓰는 회로 ' + nUsed + (pinsN ? ' / 핀 ' + pinsN * total : '') +
          (f.drawn && f.drawn.length ? ' · 도면 품번 ' + f.drawn.join(', ') + ' → 선택창에서 고름' : ''),
        확인: [hsChk, f.drawn && f.drawn.length ? '도면 품번(' + f.drawn.join(', ') + ')과 다른 품번 — 사용자가 고름' : ''].filter(Boolean).join(' / ') });
      // 행 모으기 — 같은 자재는 한 줄로(수량·근거 누적)
      var acc = {}, order = [];
      function put(key, base, q, circ0, chk) {
        if (!acc[key]) { acc[key] = { base: base, q: 0, n: 0, sqs: {}, chk: [], inst: 0 }; order.push(key); }
        var a = acc[key];
        a.q += q;
        if (circ0) { a.n += circ0.mult; if (circ0.sq != null) a.sqs[sqText(circ0.sq)] = (a.sqs[sqText(circ0.sq)] || 0) + circ0.mult; }
        if (chk && a.chk.indexOf(chk) < 0) a.chk.push(chk);
      }
      insts.forEach(function (x) {
        var m = x.mult, usedC = x.cavs.filter(function (c) { return c.used; });
        // 쓰지 않는 자리 = 핀 1~N 중 전선이 없는 자리(표에 적힌 빈 자리 포함)
        var usedSet = {}, unused = [];
        usedC.forEach(function (c) { usedSet[c.cav.toUpperCase()] = 1; });
        for (var p = 1; p <= (pinsN || 0); p++) if (!usedSet[String(p)]) unused.push(String(p));
        x.cavs.forEach(function (c) { if (!c.used && !/^\d+$/.test(c.cav) && unused.indexOf(c.cav) < 0) unused.push(c.cav); });
        kids.forEach(function (r, ri) {
          if (r.basis === '하우징당') put(ri, r, r.qty * m, null, r.optional ? '선택 자재' + (r.note ? ' — ' + r.note : '') : '');
          if (r.basis === '빈 자리당') {
            var nu = unused.filter(function (c) { return pinRangeHas(r.pinRange, c); }).length;
            if (nu) put(ri, r, r.qty * nu * m, null, !x.known ? '빈 자리를 핀 수 − 회로 수로 셈' : '');
            if (nu && acc[ri]) acc[ri].holes = (acc[ri].holes || 0) + nu * m;
          }
        });
        // 회로당 — 자리(slot)별로 후보를 고릅니다
        var slots = {}, sorder = [];
        kids.forEach(function (r, ri) {
          if (r.basis !== '회로당') return;
          var sk = r.slot || (r.kind + '|' + (r.pinRange || ''));
          if (!slots[sk]) { slots[sk] = []; sorder.push(sk); }
          slots[sk].push(ri);
        });
        sorder.forEach(function (sk) {
          var ids = slots[sk], ranged = ids.filter(function (ri) { return kids[ri].csaMin != null; }), plain = ids.filter(function (ri) { return kids[ri].csaMin == null; });
          var pr = kids[ids[0]].pinRange, guessChk = !x.known && pinRangeText(pr) ? '사용 핀 번호 모름 — 1~' + usedC.length + '번으로 가정' : '';
          usedC.forEach(function (c) {
            if (!pinRangeHas(pr, c.cav)) return;
            var cm = { mult: m, sq: c.sq };
            // 굵기 범위가 없는 행: 도구 양식이면 늘 넣고(예전 규칙), 회사 DB 의 같은 자리 후보(slot)면 대안 중 하나로 봅니다
            var isAlt = !!kids[ids[0]].slot;
            if (!isAlt) plain.forEach(function (ri) { put(ri, kids[ri], kids[ri].qty * m, cm, guessChk); });
            else if (!ranged.length && plain.length) {
              put(plain[0], kids[plain[0]], kids[plain[0]].qty * m, cm, plain.length > 1 ? '같은 자리 후보 ' + plain.length + '개(굵기 범위 없음) — 첫째 것을 넣음, 확인' : guessChk);
            }
            if (!ranged.length) return;
            if (c.sq == null) {
              ranged.forEach(function (ri) { put(ri, kids[ri], kids[ri].qty * m, cm, '전선 굵기 입력 필요(적용 ' + kids[ri].csaText + ')'); });
              return;
            }
            var cand = ranged.filter(function (ri) { var r = kids[ri]; return c.sq >= r.csaMin - 1e-9 && c.sq <= r.csaMax + 1e-9; });
            if (!cand.length && isAlt && plain.length) {   // 굵기 범위가 DB 에 없는 후보가 남아 있으면 그것으로(확인 표시)
              put(plain[0], kids[plain[0]], kids[plain[0]].qty * m, cm, 'SQ ' + sqText(c.sq) + ' 에 맞는 범위의 후보가 없어 굵기 범위 미등록 후보를 넣음 — 확인');
              return;
            }
            if (!cand.length) {
              var k0 = kids[ranged[0]];
              put('없음|' + sk + '|' + sqText(c.sq), { item: '(맞는 ' + (k0.kind || '자재') + ' 없음)', name: '', kind: k0.kind, unit: k0.unit, qty: k0.qty }, k0.qty * m, cm,
                'SQ ' + sqText(c.sq) + ' 에 맞는 ' + (k0.kind || '자재') + '가 마스터에 없음(후보 ' + ranged.map(function (ri) { return kids[ri].item + ' ' + kids[ri].csaText; }).join(', ') + ')');
              return;
            }
            cand.sort(function (a, b) { return (kids[a].csaMax - kids[a].csaMin) - (kids[b].csaMax - kids[b].csaMin) || a - b; });
            put(cand[0], kids[cand[0]], kids[cand[0]].qty * m, cm, cand.length > 1 && (kids[cand[1]].csaMax - kids[cand[1]].csaMin) === (kids[cand[0]].csaMax - kids[cand[0]].csaMin) ? '굵기 범위가 같은 후보 ' + cand.length + '개 — 비고(' + kids[cand[0]].note + ') 확인' : guessChk);
          });
        });
      });
      // 짝 하우징 — 참고로 보여 준 후보 중 사용자가 고른 것만(하우징 개수만큼)
      var mp = f.matchPick ? norm(f.matchPick) : '';
      if (mp) put('짝|' + mp, { item: mp, name: '', kind: '짝 하우징', unit: 'EA', qty: 1, basis: '하우징당', note: '' }, total, null,
        matingOptions(hs, info).indexOf(mp) < 0 ? '자재 DB 의 짝 하우징 후보가 아님 — 확인' : '');
      order.sort(function (a, b) { return (typeof a === 'number' ? a : 1e9) - (typeof b === 'number' ? b : 1e9); });
      order.forEach(function (k) {
        var a = acc[k], r = a.base, why;
        if (r.kind === '짝 하우징') why = '짝 하우징 — 참고 후보에서 사용자가 고름 · 1 × ' + total + '곳';
        else if (r.basis === '회로당' || typeof k === 'string') {
          var sq = Object.keys(a.sqs).sort(function (x, y) { return +x - +y; }).map(function (s) { return s + '×' + a.sqs[s]; });
          why = r.qty + ' × 쓰는 회로 ' + a.n + (sq.length ? ' (SQ ' + sq.join(', ') + ')' : '') + (r.pinRange ? ' · 핀 ' + r.pinRange : '');
        } else if (r.basis === '빈 자리당') why = r.qty + ' × 빈 자리 ' + (a.holes || 0) + (r.pinRange ? ' · 핀 ' + r.pinRange : '');
        else why = r.qty + ' × ' + total + '곳';
        rows.push({ 출처: 'ASSY 마스터 (' + hs + ')', 하우징: hs, 품목코드: r.item, 품목명: r.name || '', 구분: r.kind || '', 수량: Math.round(a.q * 1000) / 1000, 단위: r.unit || 'EA',
          근거: why + (r.note ? ' · ' + r.note : ''), 확인: a.chk.filter(Boolean).join(' / ') });
      });
    });
    if (!opt.merge) return rows;
    // 같은 품목코드 합치기(출처는 이어 적음)
    var by = {}, order2 = [];
    rows.forEach(function (r) {
      var k = norm(r.품목코드);
      if (!by[k]) { by[k] = Object.assign({}, r); order2.push(k); return; }
      by[k].수량 = Math.round((by[k].수량 + r.수량) * 1000) / 1000;
      if (by[k].출처.indexOf(r.출처) < 0) by[k].출처 += ' · ' + r.출처;
      if (by[k].하우징.indexOf(r.하우징) < 0) by[k].하우징 += ', ' + r.하우징;
      if (r.확인 && by[k].확인.indexOf(r.확인) < 0) by[k].확인 = (by[k].확인 ? by[k].확인 + ' / ' : '') + r.확인;
      by[k].근거 = '합계';
    });
    return order2.map(function (k) { return by[k]; });
  }
  // 엑셀 저장용: ERP BOM 과 같은 순서(품목코드·품목명·규격·단위·수량·적요) + 출처·확인
  function sheetHousingBom(rows, drawingLabel) {
    var out = [['도면', drawingLabel || '', '', '', '', '', ''], ['품목코드', '품목명', '구분', '단위', '수량', '출처', '근거', '확인']];
    rows.forEach(function (r) { out.push([r.품목코드, r.품목명, r.구분, r.단위, r.수량, r.출처, r.근거, r.확인]); });
    return out;
  }

  // ── 백업(JSON) ───────────────────────────────────────────
  function normalizeDb(p) {
    var db = emptyDb();
    if (!p || typeof p !== 'object') return db;
    ['drawings', 'groups', 'decisions', 'ecns', 'housingMaster'].forEach(function (k) { if (Array.isArray(p[k])) db[k] = p[k]; });
    // 하우징 마스터 이름·하우징 정보(핀 수 등)·GA→SQ 환산표 (2026-09-30 오전 — 회사 자재 DB 불러오기)
    if (typeof p.housingMasterName === 'string') db.housingMasterName = p.housingMasterName;
    ['housingInfo', 'gaSq', 'housingMasterStats'].forEach(function (k) { if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) db[k] = p[k]; });
    if (p.settings && typeof p.settings === 'object') {
      var s = defaultSettings();
      Object.keys(s).forEach(function (k) { if (p.settings[k] != null) s[k] = p.settings[k]; });
      WEIGHT_KEYS.forEach(function (k) { if (s.weights[k] == null) s.weights[k] = defaultSettings().weights[k]; });
      db.settings = s;
    }
    if (p._sample) db._sample = true;
    return db;
  }

  var api = {
    REQUIRED_FIELDS: REQUIRED_FIELDS, FIELD_LABEL: FIELD_LABEL, IMPORT_FIELDS: IMPORT_FIELDS,
    WEIGHT_KEYS: WEIGHT_KEYS, WEIGHT_LABEL: WEIGHT_LABEL, WEIGHT_SHORT: WEIGHT_SHORT,
    CHANGE_TYPES: CHANGE_TYPES, IMPACT_ITEMS: IMPACT_ITEMS, RECEIPT_DEPTS: RECEIPT_DEPTS, ECN_STATUS: ECN_STATUS,
    defaultSettings: defaultSettings, emptyDb: emptyDb, normalizeDb: normalizeDb,
    toDateStr: toDateStr, toDateTimeStr: toDateTimeStr, norm: norm, isBlank: isBlank, toNum: toNum, splitList: splitList,
    jaccard: jaccard, fileHash: fileHash, nextId: nextId, findBy: findBy,
    extractFields: extractFields, missingFields: missingFields, findDuplicates: findDuplicates,
    scorePair: scorePair, weightSum: weightSum, compareDrawings: compareDrawings, rankCandidates: rankCandidates, classify: classify,
    drawingStatus: drawingStatus, confirmGroup: confirmGroup, excludeCandidate: excludeCandidate,
    searchDrawings: searchDrawings, searchEcns: searchEcns,
    emptyEcn: emptyEcn, materialDelta: materialDelta, typeCounts: typeCounts, typeCountText: typeCountText,
    stockUndecided: stockUndecided, impactStatus: impactStatus, closureCheck: closureCheck, completeEcn: completeEcn,
    ecnDelayed: ecnDelayed, horizontalCandidates: horizontalCandidates, ecnGroupId: ecnGroupId, groupName: groupName,
    hitCheck: hitCheck, dashboard: dashboard, guessMapping: guessMapping, importRows: importRows,
    sheetSimilarity: sheetSimilarity, sheetGroups: sheetGroups, sheetEcnSummary: sheetEcnSummary,
    sheetMaterials: sheetMaterials, sheetActions: sheetActions, sheetHitCheck: sheetHitCheck, ecnReport: ecnReport,
    binarize: binarize, dilate: dilate, diffMasks: diffMasks, components: components, diffRegions: diffRegions,
    fitSimilarity: fitSimilarity, applySimilarity: applySimilarity,
    guessKeyColumn: guessKeyColumn, parsePastedTable: parsePastedTable, tableDiff: tableDiff,
    drawingPartRows: drawingPartRows, partRowKey: partRowKey, sheetTableDiff: sheetTableDiff,
    findFrame: findFrame, frameTransform: frameTransform, bestShift: bestShift, composeShift: composeShift, textDiff: textDiff, markMoved: markMoved, explainMoves: explainMoves, tagMovedRegions: tagMovedRegions, blockAlign: blockAlign, clipDiff: clipDiff, pointsBox: pointsBox,
    parseBomSheet: parseBomSheet, defaultCompareCols: defaultCompareCols, isExcludedBomCol: isExcludedBomCol, bomCompareCols: bomCompareCols, textLayerInfo: textLayerInfo, compareModeFor: compareModeFor, editDistance: editDistance,
    replacementCandidates: replacementCandidates, materialsFromDiff: materialsFromDiff, filledMaterials: filledMaterials,
    titleBlockFields: titleBlockFields, titleRegionItems: titleRegionItems, fileNameFields: fileNameFields, extractFromPdf: extractFromPdf, customerFromText: customerFromText, normDate: normDate,
    parseHousingMaster: parseHousingMaster, findHousings: findHousings, housingPins: housingPins, expandHousingBom: expandHousingBom, sheetHousingBom: sheetHousingBom, csaRange: csaRange,
    pinRangeText: pinRangeText, pinRangeHas: pinRangeHas, compactPins: compactPins, gaToSq: gaToSq, gaugeValue: gaugeValue, parseGaSq: parseGaSq, GA_SQ_DEFAULT: GA_SQ_DEFAULT,
    parseWireTables: parseWireTables, parseWireTablesPages: parseWireTablesPages, gaugeCheck: gaugeCheck,
    ERP_SHEETS: ERP_SHEETS, isErpMasterBook: isErpMasterBook, erpCompanies: erpCompanies, parseErpMaster: parseErpMaster,
    housingsFromCavTables: housingsFromCavTables, parseCavSpec: parseCavSpec, revFromPartNo: revFromPartNo,
    nearHousings: nearHousings, matingOptions: matingOptions, cavPages: cavPages, tablesOnPage: tablesOnPage, pagePairs: pagePairs, sheetPageSummary: sheetPageSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HNLogic = api;
})(typeof window !== 'undefined' ? window : this);
