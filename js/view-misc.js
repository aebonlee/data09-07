/* 검색·출력(FR-06·FR-09), 설정, 사용 흐름 안내 */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  // ── 검색 · 출력 ─────────────────────────
  App.view('search', function (main, parts, q) {
    var db = App.db;
    var list = L.searchDrawings(db.drawings, q);
    var ecns = q.text ? L.searchEcns(db.ecns, q.text) : [];
    var statuses = ['그룹 미확정', '미분류', '추출 보정 필요', '검토대기', '그룹 확정'];
    function fld(k, label) { return '<label class="field"><span>' + label + '</span><input type="text" name="' + k + '" value="' + esc(q[k] || '') + '"></label>'; }
    var h = '<div class="page-head"><h1>검색 · 출력</h1><div class="actions">' +
      '<button type="button" class="btn" id="expFilter">필터 결과 (엑셀)</button>' +
      '<button type="button" class="btn btn-primary" id="expAll">양식 일괄 출력 (엑셀)</button></div></div>' +
      '<form class="card form-grid" id="searchForm">' + fld('partNo', '품번') + fld('customer', '고객사') + fld('model', '기종') + fld('usage', '사용처') +
      '<label class="field"><span>상태</span><select name="status"><option value="">전체</option>' + statuses.map(function (s) { return '<option' + (q.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      fld('text', '통합 검색어') + '<div style="align-self:end" class="actions"><button class="btn btn-primary" type="submit">검색</button><a class="btn" href="#/search">초기화</a></div></form>' +
      '<p class="small muted">상태 「그룹 미확정」은 미분류·추출 보정 필요·검토대기를 모두 포함합니다. 양식 일괄 출력은 3 유사도 분석 결과표 · 4 도면 그룹 목록 · 5 ECN 요약표 · 6 변경자재 목록 · 14 유사 후보 적중 검증표 · 부서별 조치사항 · 도면 정보를 한 파일에 담습니다.</p>' +
      '<div class="card"><h2>도면 ' + list.length + '건</h2>' + App.table([
        { label: '도면 ID', render: function (d) { return '<a href="#/drawing/' + d.id + '">' + esc(d.id) + '</a>'; } },
        { label: '품번', key: 'partNo' }, { label: 'REV', key: 'rev' }, { label: '품명', key: 'partName' },
        { label: '고객사', key: 'customer' }, { label: '기종', key: 'model' }, { label: '사용처', key: 'usage' },
        { label: '그룹', render: function (d) { return d.groupId ? '<a href="#/groups?g=' + d.groupId + '">' + esc(d.groupId) + '</a>' : ''; } },
        { label: '상태', render: function (d) { return App.statusBadge(L.drawingStatus(d)); } }
      ], list, { empty: '조건에 맞는 도면이 없습니다.' }) + '</div>';
    if (q.text) {
      h += '<div class="card"><h2>ECN ' + ecns.length + '건</h2>' + App.table([
        { label: 'ECN 번호', render: function (e) { return '<a href="#/ecn/' + e.id + '">' + esc(e.ecnNo) + '</a>'; } },
        { label: '상태', render: function (e) { return App.statusBadge(e.status); } },
        { label: '대상 품번', render: function (e) { return esc(e.partNoAfter || e.partNoBefore); } },
        { label: '설계 변경 목적', key: 'purpose' }
      ], ecns, { empty: '검색어에 맞는 ECN 이 없습니다.' }) + '</div>';
    }
    main.innerHTML = h;
    $('#searchForm', main).addEventListener('submit', function (ev) {
      ev.preventDefault();
      var qs = ['partNo', 'customer', 'model', 'usage', 'status', 'text'].map(function (k) { return k + '=' + encodeURIComponent(this[k].value.trim()); }, this).join('&');
      App.go('#/search?' + qs);
    });
    $('#expFilter', main).addEventListener('click', function () {
      App.downloadXlsx('도면검색결과', [{ name: '도면검색결과', rows: drawingRows(list) }]);
    });
    $('#expAll', main).addEventListener('click', function () { exportAll(); });
  });

  function drawingRows(list) {
    var rows = [['도면 ID', '파일명', '품번', '품명', 'REV', '고객사', '기종', '사용처', '등록일', '주요 커넥터', '회로 수', '분기 수', '주요 전선·보호재', '구조 키워드', '그룹 ID', '상태', '확정자', '확정일']];
    list.forEach(function (d) {
      rows.push([d.id, d.fileName, d.partNo, d.partName, d.rev, d.customer, d.model, d.usage, d.regDate, d.connectors, d.circuits, d.branches, d.wires, d.keywords,
        d.groupId, L.drawingStatus(d), d.confirmedBy, d.confirmedAt]);
    });
    return rows;
  }
  function exportAll() {
    var db = App.db, t = App.today();
    App.downloadXlsx('양식일괄출력', [
      { name: '3_유사도분석결과표', rows: L.sheetSimilarity(db) },
      { name: '4_도면그룹목록', rows: L.sheetGroups(db) },
      { name: '5_ECN요약표', rows: L.sheetEcnSummary(db, t) },
      { name: '6_변경자재목록', rows: L.sheetMaterials(db) },
      { name: '14_유사후보적중검증표', rows: L.sheetHitCheck(db) },
      { name: '부서별조치사항', rows: L.sheetActions(db, t) },
      { name: '도면정보', rows: drawingRows(db.drawings) }
    ]);
  }
  App.exportAll = exportAll;

  // ── 설정 ────────────────────────────────
  App.view('settings', function (main) {
    var db = App.db, s = db.settings;
    var h = '<div class="page-head"><h1>설정</h1></div><form class="card" id="setForm"><h2>유사도 가중치 · 기준점수</h2>' +
      '<p class="small">원문 3.6 초기 가중치입니다. 샘플 검증 결과에 따라 조정합니다(원문). 합계를 100으로 맞추면 총점 만점이 100점이 됩니다.</p><div class="form-grid">' +
      L.WEIGHT_KEYS.map(function (k) {
        return '<label class="field"><span>' + esc(L.WEIGHT_LABEL[k]) + '</span><input type="number" min="0" max="100" step="1" name="w_' + k + '" value="' + esc(s.weights[k]) + '"></label>';
      }).join('') + '<p class="wide small">합계 <strong id="wSum">' + L.weightSum(s.weights) + '</strong></p>' +
      '<label class="field"><span>기준점수(임계값)</span><input type="number" min="0" max="100" name="threshold" value="' + esc(s.threshold) + '"><span class="hint">이상이면 기존 그룹 후보, 미만이면 신규 그룹 후보. 초기값 70은 UI 시안 표기(확인 필요)</span></label>' +
      '<label class="field"><span>후보 표시 건수</span><select name="topN">' + [1, 2, 3, 4, 5].map(function (n) { return '<option' + (+s.topN === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>비교 그룹 범위</span><select name="scope"><option value="all">전체 도면</option><option value="sameCustomer"' + (s.scope === 'sameCustomer' ? ' selected' : '') + '>동일 고객사 전체</option></select></label>' +
      '</div><h2 style="margin-top:16px">담당자 · 추출 규칙</h2><div class="form-grid">' +
      '<label class="field"><span>확정자 이름</span><input type="text" name="approver" value="' + esc(s.approver) + '"><span class="hint">그룹 확정·ECN 작성에 자동으로 들어갑니다</span></label>' +
      '<label class="field wide"><span>사용처 목록 (쉼표 구분)</span><input type="text" name="usages" value="' + esc((s.usages || []).join(', ')) + '"><span class="hint">원문 예시 MAIN, CABIN, ENGINE, PANEL — 전체 목록 확인 필요</span></label>' +
      '<label class="field wide"><span>부품번호 모양 (정규식)</span><input type="text" name="partPattern" value="' + esc(s.partPattern) + '"><span class="hint">도면 글자 중 이 모양에 맞는 낱말을 주요 커넥터·자재 후보로 뽑습니다. 실제 사내 자재품번 규칙에 맞춰 고치세요(가정 값)</span></label>' +
      '<label class="field wide"><span>키워드 사전 (쉼표 구분)</span><input type="text" name="keywordDict" value="' + esc((s.keywordDict || []).join(', ')) + '"><span class="hint">도면에 이 낱말이 있으면 구조 키워드로 넣습니다. OPT-숫자 는 자동으로 잡습니다</span></label>' +
      '</div><div class="actions" style="margin-top:12px"><button class="btn btn-primary" type="submit">설정 저장</button><button class="btn" type="button" id="resetSet">초기값으로</button></div></form>';
    h += '<div class="card"><h2>데이터 관리</h2><p class="small">데이터는 이 브라우저에만 저장됩니다. 다른 PC로 옮기거나 보관하려면 백업(JSON)을 내려받으세요. PDF 원본은 저장하지 않습니다(추출한 글자와 정보만 저장).</p>' +
      '<div class="actions"><button type="button" class="btn" id="sample">예시 데이터 불러오기</button><button type="button" class="btn" id="backup">백업 내려받기 (JSON)</button>' +
      '<label class="btn" for="restoreIn">백업 불러오기 (JSON)</label><input id="restoreIn" type="file" accept=".json,application/json" class="sr">' +
      '<button type="button" class="btn" id="xall">양식 일괄 출력 (엑셀)</button><button type="button" class="btn btn-danger" id="wipe">모두 지우기</button></div></div>';
    main.innerHTML = h;
    var f = $('#setForm', main);
    f.addEventListener('input', function () {
      var w = {}; L.WEIGHT_KEYS.forEach(function (k) { w[k] = f['w_' + k].value; });
      $('#wSum', main).textContent = L.weightSum(w);
    });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      L.WEIGHT_KEYS.forEach(function (k) { s.weights[k] = L.toNum(f['w_' + k].value) || 0; });
      s.threshold = L.toNum(f.threshold.value) == null ? 70 : L.toNum(f.threshold.value);
      s.topN = +f.topN.value; s.scope = f.scope.value; s.approver = f.approver.value.trim();
      s.usages = L.splitList(f.usages.value);
      try { new RegExp(f.partPattern.value); s.partPattern = f.partPattern.value; } catch (e) { App.toast('부품번호 모양(정규식)이 올바르지 않아 이전 값을 유지합니다.'); }
      s.keywordDict = f.keywordDict.value.split(/[,\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      App.save(); App.toast('설정을 저장했습니다. 유사도는 새 설정으로 다시 계산됩니다.');
    });
    $('#resetSet', main).addEventListener('click', function () {
      var ap = s.approver; db.settings = L.defaultSettings(); db.settings.approver = ap; App.save(); App.rerender();
    });
    $('#sample', main).addEventListener('click', function () {
      if ((db.drawings.length || db.ecns.length) && !confirm('지금 데이터를 예시 데이터로 바꿉니다. 계속할까요? (먼저 백업을 권합니다)')) return;
      App.loadSample(); App.toast('예시 데이터를 불러왔습니다.'); App.go('#/dashboard');
    });
    $('#backup', main).addEventListener('click', function () {
      App.downloadText(App.fileName('하네스도면ECN_백업').replace(/\.xlsx$/, '.json'), JSON.stringify(db, null, 1));
    });
    $('#restoreIn', main).addEventListener('change', function () {
      var file = this.files[0]; if (!file) return;
      file.text().then(function (t) {
        var p = JSON.parse(t);
        if (!p || !Array.isArray(p.drawings)) throw new Error('이 도구의 백업 파일이 아닙니다.');
        App.db = L.normalizeDb(p); App.files = {}; App.save(); App.toast('백업을 불러왔습니다.'); App.go('#/dashboard');
      }).catch(function (e) { App.toast('불러오지 못했습니다: ' + e.message); });
      this.value = '';
    });
    $('#xall', main).addEventListener('click', exportAll);
    $('#wipe', main).addEventListener('click', function () {
      if (!confirm('도면·그룹·ECN 을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      var st = db.settings; App.db = L.emptyDb(); App.db.settings = st; App.files = {}; App.save(); App.go('#/dashboard');
    });
  });

  // ── 사용 흐름 안내 (UI 시안 첫 장) ─────────────
  App.view('guide', function (main) {
    var steps = [
      ['STEP 01 · 사용자 → 시스템', 'PDF 도면 등록', '#/register', '신규 또는 변경 도면 PDF 를 1건·여러 건 올립니다.', '형식·손상 여부와 파일명·해시·품번·REV 기준 중복을 확인합니다. 중복이면 기존 연결 또는 신규 버전을 고릅니다.'],
      ['STEP 02 · AI 추출 → 사용자 보정', '정보 추출 · 보정', '#/register', '원문을 확인하고 미인식·오인식 항목을 직접 고쳐 저장합니다.', '품번·품명·REV·고객사·기종·사용처와 주요 커넥터·회로 수·분기 수를 제목란 글자에서 뽑습니다. 스캔본 OCR 은 다음 단계입니다.'],
      ['STEP 03 · AI 추천 → 사용자 검토', '유사 후보 확인', '#/similar', '상위 1~5개 후보의 총점과 항목별 점수를 보고, 비교 패널에서 공통점·차이점을 검토합니다.', '제품군 · 사용처 · 부품 · 문자 · 형상 가중합으로 순위와 근거를 냅니다. 기준점수 이상이면 기존 그룹 후보, 미만이면 신규 그룹 후보입니다.'],
      ['STEP 04 · 담당자 승인', '그룹 확정', '#/similar', '기존 그룹 연결, 후보 변경, 제외, 신규 그룹 생성 중 하나를 고르고 판단 메모를 남깁니다.', '확정자·확정일시·판단 메모를 이력으로 남깁니다.'],
      ['STEP 05 · ECN 있을 때', 'ECN · 변경자재 연결', '#/ecn', 'ECN 번호·변경사유·전후 REV 를 등록하고 변경자재를 신규·삭제·대체·수량변경·사양변경으로 기록합니다.', '적용일·재고처리·담당부서 누락과 영향도 미검토를 표시하고, 미정이 있으면 완료 처리를 막습니다.'],
      ['STEP 06 · 전 부서 활용', '조회 · 수평전개 · 출력', '#/search', '품번·고객사·기종·사용처로 이력을 찾고, 동일·유사 그룹의 추가 검토대상을 확인해 엑셀로 내보냅니다.', '변경자재 대장·진행현황·지연 ECN 을 모읍니다. 판단 근거가 개인이 아닌 기록으로 남습니다.']
    ];
    var h = '<div class="page-head"><h1>사용 흐름 안내</h1></div><p class="principle">운영원칙 — AI는 후보를 추천하고, 분류와 설계변경의 최종 판단은 담당자가 승인합니다.</p><ol class="flow">' +
      steps.map(function (s) {
        return '<li><div class="step-no">' + esc(s[0]) + '</div><h3>' + esc(s[1]) + '</h3><p class="small"><strong>사용자가 하는 일</strong><br>' + esc(s[3]) + '</p>' +
          '<p class="small"><strong>도구가 하는 일</strong><br>' + esc(s[4]) + '</p><a href="' + s[2] + '">화면 열기 →</a></li>';
      }).join('') + '</ol>' +
      '<div class="card" style="margin-top:16px"><h2>부서별 사용</h2><ul class="small">' +
      '<li>개발 — 유사도면 탐색, ECN 등록, 영향 검토</li><li>설계 — 과거 변경이력, BOM 정합성 확인</li><li>생산기술 — 작업지시서, 조립·검사 JIG 영향</li>' +
      '<li>구매·자재 — 신규 발주, 구자재 재고·적용시점</li><li>품질 — 초도품 확인, 수평전개, 승인자료</li><li>관리자 — 진행현황, 지연·미확정 사항</li></ul>' +
      '<p class="small muted">위 내용은 수강생 UI 시안(docs/source/02_유사도면_ECN_UI시안.pdf)의 사용자 업무 흐름을 옮긴 것입니다.</p></div>';
    main.innerHTML = h;
  });
})(window);
