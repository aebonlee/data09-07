/* 화면 ① 대시보드, ② 도면 등록·정보 추출, 도면 상세 */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  // ── ① 대시보드 ────────────────────────────
  App.view('dashboard', function (main) {
    var db = App.db, st = L.dashboard(db, App.today());
    var recent = db.drawings.slice().sort(function (a, b) { return String(b.regDate).localeCompare(String(a.regDate)) || b.id.localeCompare(a.id); }).slice(0, 6);
    var waiting = db.drawings.filter(function (d) { return L.drawingStatus(d) === '검토대기'; });
    var openEcn = db.ecns.filter(function (e) { return e.status !== '완료'; });
    var h = '<div class="page-head"><h1>대시보드</h1><div class="actions">' +
      '<a class="btn btn-primary" href="#/register">PDF 등록</a>' +
      '<a class="btn" href="#/similar">분석 시작</a>' +
      '<a class="btn" href="#/ecn/new">ECN 등록</a>' +
      '<a class="btn" href="#/search">결과 내보내기 (엑셀)</a></div></div>' +
      '<p class="principle">AI는 유사 후보를 추천하고, 그룹 분류와 설계변경 판단은 담당자가 승인합니다.</p>';
    if (!db.drawings.length && !db.ecns.length) {
      h += '<div class="card"><h2>처음 쓰시나요?</h2><p>도면이 아직 없습니다. PDF 도면을 등록하거나, 화면을 먼저 둘러보려면 예시 데이터를 불러오세요.</p>' +
        '<div class="actions"><a class="btn btn-primary" href="#/register">PDF 도면 등록</a><button type="button" class="btn" id="loadSample">예시 데이터 불러오기</button>' +
        '<a class="btn" href="#/guide">사용 흐름 안내</a></div></div>';
    }
    h += '<div class="kpis">' +
      kpi('전체 도면', st.total, db._sample ? '예시 데이터셋 기준' : '등록된 도면', '#/search') +
      kpi('미분류 도면', st.unclassified, '그룹 미확정', '#/search?status=' + encodeURIComponent('그룹 미확정')) +
      kpi('검토대기', st.review, 'AI 추천 완료 · 담당자 승인 전', '#/similar') +
      kpi('진행 중 ECN', st.ecnOpen, '필수정보 미정 ' + st.ecnMissing + '건' + (st.ecnDelayed ? ' · 지연 ' + st.ecnDelayed + '건' : ''), '#/ecn') +
      '</div>';
    h += '<div class="dash-grid"><div class="card"><div class="page-head"><h2>최근 등록 도면</h2><a href="#/search">전체 보기</a></div>' +
      App.table([
        { label: '품번', render: function (d) { return '<a href="#/drawing/' + d.id + '">' + esc(d.partNo || d.id) + '</a>'; } },
        { label: '품명 · 사용처', render: function (d) { return esc(d.partName || '') + (d.usage ? ' · ' + esc(d.usage) : ''); } },
        { label: '고객사 · 기종', render: function (d) { return esc(d.customer || '') + (d.model ? ' · ' + esc(d.model) : ''); } },
        { label: 'REV', key: 'rev' },
        { label: '상태', render: function (d) { return App.statusBadge(L.drawingStatus(d)); } }
      ], recent, { empty: '등록된 도면이 없습니다.' }) + '</div>';
    h += '<div><div class="card"><h2>추천대기 도면</h2><ul class="pick-list">';
    if (!waiting.length) h += '<li class="muted">승인 대기 중인 도면이 없습니다.</li>';
    waiting.slice(0, 6).forEach(function (d) {
      var c = L.rankCandidates(d, db.drawings, db.settings);
      var cls = L.classify(c, db.settings.threshold);
      h += '<li><strong>' + esc(App.drawingLabel(d)) + '</strong><br><span class="small muted">' +
        (c[0] ? '1순위 후보 ' + esc(c[0].partNo) + ' · ' + c[0].total + '점 — ' : '') + esc(cls.text) + '</span><br>' +
        '<a href="#/similar/' + d.id + '">후보 확인 →</a></li>';
    });
    h += '</ul></div><div class="card"><h2>지연 · 미완료 ECN</h2><ul class="pick-list">';
    if (!openEcn.length) h += '<li class="muted">진행 중인 ECN 이 없습니다.</li>';
    openEcn.forEach(function (e) {
      var c = L.closureCheck(e);
      h += '<li><strong>' + esc(e.ecnNo) + '</strong> ' + App.statusBadge(L.ecnDelayed(e, App.today()) ? '지연' : e.status) + '<br><span class="small">' +
        esc(e.partNoBefore || e.partNoAfter) + ' REV ' + esc(e.revBefore) + ' → ' + esc(e.revAfter) + ' · ' + esc(e.purpose) + '</span><br>' +
        (c.problems.length ? '<span class="small muted">미정: ' + esc(c.problems.join(' / ')) + '</span><br>' : '') +
        '<a href="#/ecn/' + e.id + '">ECN 열기 →</a></li>';
    });
    h += '</ul></div></div></div>';
    main.innerHTML = h;
    var ls = $('#loadSample', main);
    if (ls) ls.addEventListener('click', function () { App.loadSample(); App.toast('예시 데이터를 불러왔습니다.'); App.rerender(); });
  });
  function kpi(label, v, sub, href) {
    return '<a class="kpi" href="' + href + '"><div class="k-label">' + esc(label) + '</div><div class="k-value">' + v + '</div><div class="k-sub">' + esc(sub) + '</div></a>';
  }

  App.stepsBar = function (on) {
    var names = ['등록', '추출 검토', '유사 후보', '그룹 확정', 'ECN 연결'];
    return '<ol class="steps">' + names.map(function (n, i) {
      return '<li class="' + (i + 1 === on ? 'on' : (i + 1 < on ? 'done' : '')) + '">' + (i + 1) + ' ' + n + '</li>';
    }).join('') + '</ol>';
  };

  // ── ② 도면 등록 · 정보 추출 ─────────────────
  App.view('register', function (main, parts) {
    var db = App.db;
    var id = parts[0] || App.ui.regSel || '';
    var d = id ? L.findBy(db.drawings, id) : null;
    if (!d) id = '';
    App.ui.regSel = id;
    var list = db.drawings.slice().reverse();
    var h = '<div class="page-head"><h1>도면 등록 · 정보 추출</h1></div>' + App.stepsBar(d ? 2 : 1) +
      '<div class="reg-grid"><div class="reg-left">' +
      '<div class="card"><div class="dropzone" id="drop"><p><strong>PDF 도면을 끌어다 놓거나<br>여러 건을 한 번에 선택</strong></p>' +
      '<label class="btn btn-primary" for="pdfInput">파일 선택</label><input id="pdfInput" type="file" accept="application/pdf,.pdf" multiple class="sr"></div>' +
      '<div class="actions" style="margin-top:10px"><button type="button" class="btn btn-sm" id="manualNew">PDF 없이 직접 입력</button>' +
      '<button type="button" class="btn btn-sm" id="importXls">도면 대장 엑셀 가져오기</button></div>' +
      '<input id="xlsInput" type="file" accept=".xlsx,.xls,.csv" class="sr">' +
      '<h3 style="margin-top:14px">파일 목록 (' + list.length + ')</h3><ul class="file-list" id="fileList">';
    list.slice(0, 40).forEach(function (x) {
      var miss = L.missingFields(x).length;
      var dup = L.findDuplicates(db.drawings, x);
      h += '<li data-id="' + x.id + '" class="' + (x.id === id ? 'sel' : '') + '"><div class="fn">' + esc(x.fileName || x.partNo || x.id) + '</div>' +
        '<div class="small muted">' + esc(x.id) + ' · ' + (miss ? '확인 ' + miss + '건' : '추출 완료') + (x.checkedAt ? ' · 확인됨' : x.source === 'PDF' ? ' · 확인 전' : '') + (dup.length ? ' · <span class="src-missing">중복 의심 ' + esc(dup[0].id) + '</span>' : '') +
        ' · ' + esc(L.drawingStatus(x)) + '</div></li>';
    });
    if (!list.length) h += '<li class="muted">아직 없습니다.</li>';
    h += '</ul></div>' +
      '<div class="card"><h3>분석 설정</h3>' +
      '<label class="field"><span>비교 그룹 범위</span><select id="scopeSel"><option value="all">전체 도면</option><option value="sameCustomer">동일 고객사 전체</option></select></label>' +
      '<label style="display:flex;gap:8px;margin-top:10px;align-items:center"><input type="checkbox" disabled> <span class="small">OCR 보조 사용 — 스캔본 문자 인식은 다음 단계(확장)입니다</span></label></div></div>';
    // 가운데: 미리보기 + 원문
    h += '<div class="reg-center"><div class="card"><div class="page-head"><h3 style="margin:0">도면 미리보기' + (d ? ' · ' + esc(d.fileName || d.partNo) : '') + '</h3>' +
      '<label class="small">페이지 <select id="pageSel" style="width:auto;min-height:32px"></select></label></div>' +
      '<div class="preview" id="preview"><p class="muted small" style="padding:12px">' +
      (d ? (App.files[d.id] ? '불러오는 중…' : '원본 PDF 는 이 창에서 등록한 동안만 미리보기가 됩니다. 다시 보려면 아래에서 같은 파일을 연결하세요.') : '왼쪽에서 PDF 를 등록하거나 파일 목록에서 도면을 고르세요.') +
      '</p></div>' +
      (d && !App.files[d.id] && d.fileName ? '<label class="small" style="display:block;margin-top:8px">원본 다시 연결 <input id="relink" type="file" accept=".pdf,application/pdf"></label>' : '') +
      '</div><div class="card"><h3>원문 확인 (추출 텍스트)</h3>' +
      '<textarea id="rawText" class="raw-text" placeholder="PDF 에서 뽑은 글자가 여기에 표시됩니다. 직접 붙여 넣고 「원문에서 다시 추출」을 눌러도 됩니다.">' + esc(d ? d.rawText || '' : '') + '</textarea>' +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-sm" id="reExtract"' + (d ? '' : ' disabled') + '>원문에서 다시 추출</button>' +
      '<span class="small muted">직접 고친 칸은 덮어쓰지 않습니다.</span></div></div></div>';
    // 오른쪽: 추출정보 편집
    h += '<div class="reg-right"><div class="card">' + (d ? editForm(d) : '<h3>추출정보 편집</h3><p class="muted">도면을 고르면 품번·품명·REV·고객사·기종·사용처와 특징을 확인하고 고칠 수 있습니다.</p>') + '</div></div></div>';
    main.innerHTML = h;
    $('#scopeSel', main).value = db.settings.scope || 'all';
    $('#scopeSel', main).addEventListener('change', function () { db.settings.scope = this.value; App.save(); App.toast('비교 그룹 범위를 저장했습니다.'); });
    wireUpload(main);
    $$('#fileList li[data-id]', main).forEach(function (li) {
      li.addEventListener('click', function () { App.go('#/register/' + li.getAttribute('data-id')); });
    });
    $('#manualNew', main).addEventListener('click', function () {
      var nd = { id: L.nextId(db.drawings, 'DWG-', 4), fileName: '', regDate: L.toDateStr(new Date()), source: '직접 입력', srcMap: {} };
      db.drawings.push(nd); App.save(); App.go('#/register/' + nd.id);
    });
    $('#importXls', main).addEventListener('click', function () { $('#xlsInput', main).click(); });
    $('#xlsInput', main).addEventListener('change', function () { if (this.files[0]) importDrawingsFlow(this.files[0]); this.value = ''; });
    if (d) {
      wireEditForm(main, d);
      if (App.files[d.id]) renderPreview(d.id, 1);
      var rl = $('#relink', main);
      if (rl) rl.addEventListener('change', function () {
        var f = this.files[0]; if (!f) return;
        f.arrayBuffer().then(function (buf) {
          var hash = L.fileHash(new Uint8Array(buf));
          if (d.fileHash && d.fileHash !== hash && !confirm('등록 때와 다른 파일입니다(해시 불일치). 그래도 미리보기에 연결할까요?')) return;
          App.files[d.id] = buf; App.rerender();
        });
      });
      $('#reExtract', main).addEventListener('click', function () {
        d.rawText = $('#rawText', main).value;
        var ps = d.pageSize || [0, 0];
        applyExtraction(d, L.extractFromPdf(d.rawText, d.titleItems || [], ps[0], ps[1], d.fileName, db.settings), true);
        App.save(); App.toast('원문에서 다시 추출했습니다.'); App.rerender();
      });
    }
  });

  var SRC_TEXT = { auto: '자동', title: '제목란', file: '파일명', guess: '추정', manual: '수정', missing: '미인식' };
  function editForm(d) {
    var src = d.srcMap || {};
    var miss = L.missingFields(d);
    function f(key, hint, type) {
      var s = L.isBlank(d[key]) ? (L.REQUIRED_FIELDS.indexOf(key) >= 0 ? 'missing' : '') : (src[key] || '');
      return '<label class="field' + (s === 'missing' ? ' field-missing' : '') + '"><span>' + esc(L.FIELD_LABEL[key]) +
        (s ? '<span class="src-tag src-' + s + '"> · ' + SRC_TEXT[s] + '</span>' : '') + '</span>' +
        '<input type="' + (type || 'text') + '" name="' + key + '" value="' + esc(d[key] == null ? '' : d[key]) + '"' + (hint ? ' placeholder="' + esc(hint) + '"' : '') + '></label>';
    }
    var usages = App.db.settings.usages || [];
    return '<div class="page-head"><h3 style="margin:0">추출정보 편집</h3><span class="small muted">모든 값 수정 가능</span></div>' +
      (miss.length ? '<div class="warn-box small">미인식 항목 ' + miss.length + '건: ' + esc(miss.map(function (k) { return L.FIELD_LABEL[k]; }).join(', ')) + ' — 직접 입력한 뒤 저장하면 분석에 반영됩니다.</div>' : '') +
      dupWarn(d) + checkBox(d) + bomHint(d) +
      '<form id="editForm"><div class="form-grid">' + f('partNo') + f('rev', '품번 끝 영문이 없으면 직접 입력') + f('customer') + f('model') + f('partName') +
      f('usage', '도면에 적혀 있지 않음 — 직접 입력 (예: ' + usages.join(', ') + ')') + f('dwgDate', 'YYYY-MM-DD') +
      '</div><h3 style="margin-top:14px">추출 특징</h3><div class="form-grid">' +
      '<div class="wide">' + f('connectors', '쉼표로 구분 — 예: CN-0221, CN-0118') + '</div>' +
      f('circuits', '', 'number') + f('branches', '', 'number') +
      '<div class="wide">' + f('wires', '예: WR-0085, TB-0019, 코루게이트 튜브') + '</div>' +
      '<div class="wide">' + f('keywords', '주기·회로명·옵션명 — 예: OPT-2, 방수') + '</div>' +
      '</div><p class="small muted" style="margin-top:8px">도면 ID ' + esc(d.id) + ' · 등록일 ' + esc(d.regDate || '') + ' · ' + esc(d.source || 'PDF') + '</p>' +
      '<div class="actions"><button type="submit" class="btn">저장</button>' +
      '<button type="button" class="btn btn-primary" id="goSimilar">유사도 분석 시작 →</button>' +
      '<button type="button" class="btn btn-danger btn-sm" id="delDrawing">도면 삭제</button></div></form>' + cavCard(d);
  }
  // CAV 표 · 전선 굵기 비교 (2026-09-30 오전 답 3). 등록할 때 PDF 글자에서 읽어 둔 표(d.cavTables)를 보여 줍니다.
  function cavCard(d) {
    var ts = d.cavTables;
    if (!ts) return '<p class="small muted" style="margin-top:14px">CAV 표: 읽은 기록이 없습니다(예시 도면이거나 CAV 표 읽기 전에 등록한 도면). PDF 로 다시 등록하면 읽습니다.</p>';
    var cav = ts.filter(function (t) { return t.kind === 'cav'; }), wl = ts.filter(function (t) { return t.kind === 'wires'; });
    if (!ts.length) return '<p class="small muted" style="margin-top:14px">CAV 표: 읽은 표가 없습니다(글자 정보가 없는 PDF 이거나 CAV · CSA 머리가 없는 도면). BOM 구성에서 사용 핀·굵기를 직접 넣을 수 있습니다.</p>';
    var gs = App.db.gaSq || {}, gc = L.gaugeCheck(ts, gs);
    function sq(t, g) { var v = L.gaugeValue(g, t.gaugeHead, gs); return v && v.sq != null ? String(Math.round(v.sq * 1000) / 1000) : ''; }
    var h = '<h3 style="margin-top:16px">CAV 표 · 전선 굵기 <span class="small muted">— PDF 글자에서 읽음</span></h3>' +
      '<p class="small">커넥터 표 ' + cav.length + '개 · 전선표 ' + wl.length + '개. 같은 전선을 두 곳 이상에서 비교한 ' + gc.compared + '가닥 중 ' +
      (gc.mismatches.length ? '<strong class="src-missing">다른 곳 ' + gc.mismatches.length + '건</strong>' : '<strong>다른 곳 없음</strong>') + '.</p>';
    if (gc.mismatches.length) h += '<div class="warn-box small"><ul style="margin:0">' + gc.mismatches.map(function (m) {
      return '<li>' + esc(m.kind) + (m.wire ? ' — 전선 ' + esc(m.wire) : '') + ': ' + m.entries.map(function (e) { return esc(e.where) + ' <strong>' + esc(e.value) + '</strong>'; }).join(' · ') + '</li>';
    }).join('') + '</ul></div>';
    h += '<details class="small"><summary>읽은 커넥터 표 ' + cav.length + '개 보기</summary>' + App.table([
      { label: '커넥터', render: function (t) { return esc(t.name || '—'); } },
      { label: '하우징 품번', render: function (t) { return esc(t.housing || '') + (t.maker ? ' <span class="muted">' + esc(t.maker) + '</span>' : ''); } },
      { label: '쓰는 자리 / 표의 자리', render: function (t) { return t.rows.filter(function (r) { return r.wire || r.gauge; }).length + ' / ' + t.rows.length; } },
      { label: '핀 · 전선 · 굵기(SQ)', render: function (t) { return esc(t.rows.map(function (r) { return r.cav + (r.wire || r.gauge ? ':' + (r.wire || '?') + ' ' + r.gauge + (sq(t, r.gauge) && !/^\d+(\.\d+)?$/.test(r.gauge) ? '(' + sq(t, r.gauge) + ')' : '') : ':빈 자리'); }).join(', ')); } },
      { label: '쪽', key: 'page' }
    ], cav) + '<p class="muted">GA 는 ' + (Object.keys(gs).length ? '회사 환산표(자재 DB 의 GA/SQ 환산)' : '일반 환산값(가정 — 회사 자재 DB 를 BOM 구성에서 불러오면 그 환산표를 씀)') + '로 SQ 로 바꿉니다.</p></details>';
    return h;
  }
  // 올릴 때 자동으로 읽어 저장한 값의 확인 안내(2026-09-29 저녁 「문의04」).
  // 저장은 이미 되어 있고, 사람이 한 번 보고 「확인 완료」를 누르면 확인 일시·확인자를 남깁니다.
  function checkBox(d) {
    var src = d.srcMap || {}, auto = Object.keys(src).filter(function (k) { return /^(title|auto|file|guess)$/.test(src[k]) && !L.isBlank(d[k]) && L.FIELD_LABEL[k]; });
    if (d.checkedAt) return '<p class="small muted">읽은 값 확인: ' + esc(d.checkedAt + (d.checkedBy ? ' · ' + d.checkedBy : '')) + '</p>';
    if (!auto.length) return '';
    return '<div class="ok-box small check-box">도면을 올리면서 <strong>' + esc(auto.map(function (k) { return L.FIELD_LABEL[k] + '(' + SRC_TEXT[src[k]] + ')'; }).join(', ')) + '</strong>' +
      ' 을(를) 읽어 이미 저장했습니다. 도면과 맞는지 보고, 고칠 칸은 고친 뒤 <strong>「확인 완료」</strong>를 눌러 주세요. 「파일명·추정」 칸은 특히 확인이 필요합니다.' +
      '<div class="actions" style="margin-top:6px"><button type="button" class="btn btn-sm btn-primary" id="checkDone">확인 완료</button></div></div>';
  }
  // 하우징 ASSY 마스터가 있으면 이 도면에서 찾은 하우징 수와 BOM 구성 화면 바로가기(2026-09-29 저녁 「문의03」)
  function bomHint(d) {
    var m = App.db.housingMaster || [];
    if (!m.length) return '';
    var f = L.findHousings(d.rawText || '', d.connectors || '', m, App.db.housingInfo);
    return '<p class="small">' + (f.length ? '하우징 ' + f.length + '종(' + esc(f.map(function (x) { return x.housing + ' ×' + x.count; }).join(', ')) + ')을 찾았습니다. ' : '마스터에 있는 하우징을 이 도면 글자에서 찾지 못했습니다. ') +
      '<a href="#/bom?d=' + d.id + '">BOM 구성 →</a></p>';
  }
  function dupWarn(d) {
    var dup = L.findDuplicates(App.db.drawings, d);
    if (!dup.length) return '';
    return '<div class="danger-box small">중복 의심 — ' + dup.map(function (x) { return esc(x.id + ' ' + (x.partNo || '') + ' ' + (x.rev || '') + ' (' + x.reasons.join('·') + ')'); }).join(', ') +
      '. 같은 도면이면 이 행을 지우고 기존 도면을 쓰고, 개정본이면 REV 를 확인하세요.</div>';
  }
  function wireEditForm(main, d) {
    var form = $('#editForm', main);
    function collect() {
      d.srcMap = d.srcMap || {};
      $$('input[name]', form).forEach(function (inp) {
        var k = inp.name, v = inp.value.trim();
        if (k === 'circuits' || k === 'branches') v = v === '' ? '' : L.toNum(v);
        if (String(d[k] == null ? '' : d[k]) !== String(v)) { d[k] = v; d.srcMap[k] = 'manual'; }
      });
      d.updatedAt = L.toDateTimeStr(new Date());
      d.updatedBy = App.db.settings.approver || '';
    }
    form.addEventListener('submit', function (ev) { ev.preventDefault(); collect(); App.save(); App.toast('저장했습니다. 수정값은 다음 분석에 반영됩니다.'); App.rerender(); });
    var cd = $('#checkDone', main);
    if (cd) cd.addEventListener('click', function () {
      collect();
      d.checkedAt = L.toDateTimeStr(new Date()); d.checkedBy = App.db.settings.approver || '';
      App.save(); App.toast('읽은 값을 확인 완료로 기록했습니다.'); App.rerender();
    });
    $('#goSimilar', main).addEventListener('click', function () {
      collect(); App.save();
      App.go('#/similar/' + d.id);
    });
    $('#delDrawing', main).addEventListener('click', function () {
      var used = App.db.ecns.filter(function (e) { return e.drawingBeforeId === d.id || e.drawingAfterId === d.id; }).length;
      if (!confirm((used ? '이 도면을 쓰는 ECN 이 ' + used + '건 있습니다. ' : '') + d.id + ' 도면을 삭제할까요?')) return;
      App.db.drawings = App.db.drawings.filter(function (x) { return x.id !== d.id; });
      delete App.files[d.id]; App.ui.regSel = '';
      App.save(); App.go('#/register');
    });
  }

  // 추출 결과 반영 — keepManual 이면 직접 고친 칸은 두기
  function applyExtraction(d, ex, keepManual) {
    d.srcMap = d.srcMap || {};
    Object.keys(ex.fields).forEach(function (k) {
      if (keepManual && d.srcMap[k] === 'manual' && !L.isBlank(d[k])) return;
      d[k] = ex.fields[k]; d.srcMap[k] = ex.source[k];
    });
  }

  // ── 업로드 ─────────────────────────────
  function wireUpload(main) {
    var drop = $('#drop', main), input = $('#pdfInput', main);
    input.addEventListener('change', function () { handleFiles(Array.prototype.slice.call(this.files)); this.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { handleFiles(Array.prototype.slice.call(e.dataTransfer.files || [])); });
  }

  App.handlePdfFiles = handleFiles;
  function handleFiles(files) {
    if (!files.length) return;
    var lastId = '', report = [];
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return registerOne(file).then(function (r) { report.push(r.msg); if (r.id) lastId = r.id; });
      });
    });
    chain.then(function () {
      App.save();
      if (report.length > 1 || /재등록|중복|스캔/.test(report.join(''))) {
        App.dialog('등록 결과', '<ul>' + report.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>', [{ label: '확인', value: 'ok', primary: true }]);
      } else App.toast(report[0] || '');
      App.go('#/register/' + (lastId || ''));
    });
  }

  function registerOne(file) {
    var db = App.db;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      return Promise.resolve({ msg: file.name + ' — PDF 가 아닙니다. PDF 로 다시 등록하세요.' });
    }
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var head = String.fromCharCode.apply(null, bytes.slice(0, 5));
      if (head !== '%PDF-') return { msg: file.name + ' — PDF 형식이 아니거나 손상되었습니다. 재등록하세요.' };
      var cand = { id: '', fileName: file.name, fileHash: L.fileHash(bytes) };
      return extractPdfText(buf.slice(0)).then(function (res) {
        // 제목란(글자 위치) → 글자 라벨 → 파일명 순서로 채웁니다(2026-09-29 저녁 「문의04」)
        // 글자 정보가 거의 없거나 깨진 PDF 는 제목란·라벨 읽기를 하지 않고 파일명 규칙만 씁니다(엉뚱한 값이 채워지지 않게)
        var tl = L.textLayerInfo(res.items);
        var ex = tl.has ? L.extractFromPdf(res.text, res.items, res.pw, res.ph, file.name, db.settings) : L.extractFromPdf('', [], res.pw, res.ph, file.name, db.settings);
        cand.partNo = ex.fields.partNo || ''; cand.rev = ex.fields.rev || '';
        var dup = L.findDuplicates(db.drawings, cand);
        var decide = dup.length ? askDuplicate(file.name, dup) : Promise.resolve('new');
        return decide.then(function (choice) {
          if (choice === 'link') {
            App.files[dup[0].id] = buf;
            return { id: dup[0].id, msg: file.name + ' — 기존 도면 ' + dup[0].id + ' 에 연결했습니다(새로 만들지 않음).' };
          }
          if (choice !== 'new') return { msg: file.name + ' — 등록을 취소했습니다.' };
          var d = {
            id: L.nextId(db.drawings, 'DWG-', 4), fileName: file.name, fileHash: cand.fileHash, fileSize: bytes.length,
            pages: res.pages, regDate: L.toDateStr(new Date()), source: 'PDF', rawText: res.text.slice(0, 30000), srcMap: {},
            // 제목란 영역의 글자 조각만 둡니다(「원문에서 다시 추출」 때 제목란을 다시 읽기 위해). 도면 전체 글자 위치는 저장하지 않습니다.
            titleItems: L.titleRegionItems(res.items, res.pw, res.ph).slice(0, 300), pageSize: [res.pw, res.ph]
          };
          if (dup.length) d.versionOf = dup[0].id;
          // CAV 표(CAV · WIRE · CSA / PIN · CORE · GA)와 전선표 — 글자 정보가 있는 PDF 만(2026-09-30 답 3)
          d.cavTables = tl.has ? L.parseWireTablesPages(res.pageItems || []) : [];
          applyExtraction(d, ex, false);
          db.drawings.push(d);
          App.files[d.id] = buf;
          var miss = L.missingFields(d).length;
          var scan = !tl.has;   // 글자 정보 판정은 도면 비교와 같은 기준(logic.textLayerInfo)
          var tbn = Object.keys(ex.title || {}).length;
          var ncav = (d.cavTables || []).filter(function (t) { return t.kind === 'cav'; }).length;
          return { id: d.id, msg: file.name + ' — ' + d.id + ' 자동 저장 · ' + (tbn ? '제목란에서 ' + tbn + '칸 읽음 · ' : '') + (ncav ? 'CAV 표 ' + ncav + '개 읽음 · ' : '') +
            (scan ? '글자 정보가 없는 PDF(글자를 선으로 그림)라 파일명에서만 읽었습니다. 나머지는 미리보기를 보고 입력해 주세요.' : (miss ? '확인 필요 ' + miss + '건' : '추출 완료')) + (dup.length ? ' · 신규 버전으로 등록' : '') };
        });
      }, function (err) {
        return { msg: file.name + ' — PDF 를 읽지 못했습니다(손상 가능). 재등록하세요. (' + (err && err.message || err) + ')' };
      });
    });
  }

  function askDuplicate(name, dup) {
    var x = dup[0];
    return App.dialog('중복 의심', '<p><strong>' + esc(name) + '</strong> 이(가) 기존 도면과 겹칩니다.</p><p>' + esc(x.id + ' · ' + (x.partNo || '') + ' REV ' + (x.rev || '') + ' — 기준: ' + x.reasons.join('·')) + '</p>' +
      '<p class="small muted">같은 파일이면 「기존 파일 연결」, 개정본이면 「신규 버전으로 등록」을 고르세요.</p>',
      [{ label: '취소', value: 'cancel' }, { label: '기존 파일 연결', value: 'link' }, { label: '신규 버전으로 등록', value: 'new', primary: true }]);
  }

  // PDF 글자 뽑기 — 브라우저 안에서만 처리합니다(도면이 밖으로 나가지 않음)
  function loadPdf(buf) {
    if (!root.pdfjsLib) return Promise.reject(new Error('PDF 라이브러리(vendor/pdf.min.js)를 불러오지 못했습니다.'));
    return root.pdfjsLib.getDocument({ data: new Uint8Array(buf), cMapUrl: 'vendor/cmaps/', cMapPacked: true, isEvalSupported: false }).promise;
  }
  function extractPdfText(buf) {
    return loadPdf(buf).then(function (pdf) {
      var n = Math.min(pdf.numPages, 20), texts = [], chain = Promise.resolve(), out = { items: [], pw: 0, ph: 0 };
      for (var i = 1; i <= n; i++) {
        (function (p) {
          var pg;
          chain = chain.then(function () { return pdf.getPage(p); }).then(function (page) { pg = page; return page.getTextContent(); }).then(function (tc) {
            var s = '';
            tc.items.forEach(function (it) { s += it.str + (it.hasEOL ? '\n' : ' '); });
            texts.push(s.replace(/[ \t]+/g, ' ').trim());
            // 글자 위치(y 는 위에서부터 잰 글자 밑줄, h 는 글자 높이). 1쪽은 제목란 읽기, 모든 쪽은 CAV 표 읽기(2026-09-30)에 씁니다
            var vp = pg.getViewport({ scale: 1 });
            var its = tc.items.filter(function (it) { return it.str && it.str.trim(); }).map(function (it) {
              var t = it.transform;
              return { str: it.str, x: Math.round(t[4] * 10) / 10, y: Math.round((vp.height - t[5]) * 10) / 10, w: Math.round((it.width || 0) * 10) / 10, h: Math.round(Math.sqrt(t[2] * t[2] + t[3] * t[3]) * 10) / 10 };
            });
            out.pageItems = out.pageItems || [];
            out.pageItems.push({ items: its });
            if (p === 1) { out.pw = vp.width; out.ph = vp.height; out.items = its; }
          });
        })(i);
      }
      return chain.then(function () { out.text = texts.join('\n'); out.pages = pdf.numPages; return out; });
    });
  }
  App.extractPdfText = extractPdfText;
  App.loadPdf = loadPdf;

  function renderPreview(id, pageNo) {
    var box = $('#preview'), sel = $('#pageSel');
    if (!box || !App.files[id]) return;
    loadPdf(App.files[id].slice(0)).then(function (pdf) {
      if (sel && !sel.options.length) {
        for (var i = 1; i <= pdf.numPages; i++) sel.add(new Option(i + ' / ' + pdf.numPages, i));
        sel.onchange = function () { renderPreview(id, +sel.value); };
      }
      return pdf.getPage(pageNo).then(function (page) {
        var vp0 = page.getViewport({ scale: 1 });
        var scale = Math.min(2, Math.max(0.5, (box.clientWidth || 600) / vp0.width));
        var vp = page.getViewport({ scale: scale });
        var c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        box.innerHTML = ''; box.appendChild(c);
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      });
    }).catch(function (e) { box.innerHTML = '<p class="small src-missing" style="padding:12px">미리보기를 그리지 못했습니다: ' + esc(e.message) + '</p>'; });
  }

  // ── 도면 대장 엑셀 가져오기 (열 맞추기) ───────
  function importDrawingsFlow(file) {
    if (!App.xlsxReady()) return;
    App.readTable(file).then(function (book) {
      var names = Object.keys(book).filter(function (n) { return book[n].length; });
      if (!names.length) { App.toast('읽을 행이 없습니다.'); return; }
      var sheet = names[0];
      showMapping(book, sheet, names);
    }).catch(function (e) { App.toast('파일을 읽지 못했습니다: ' + e.message); });
  }
  function showMapping(book, sheet, names) {
    var rows = book[sheet];
    var headers = Object.keys(rows[0] || {});
    var map = L.guessMapping(headers);
    var opts = function (f) {
      return '<option value="">(가져오지 않음)</option>' + headers.map(function (hd) { return '<option' + (map[f] === hd ? ' selected' : '') + '>' + esc(hd) + '</option>'; }).join('');
    };
    var html = '<p class="small">내 파일의 열 이름이 도구 항목과 다를 수 있습니다. 각 항목에 맞는 열을 고르세요. 품번이 없는 행은 건너뜁니다.</p>' +
      (names.length > 1 ? '<label class="field"><span>시트</span><select id="mapSheet">' + names.map(function (n) { return '<option' + (n === sheet ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' : '') +
      '<div class="map-grid" style="margin-top:10px">' + L.IMPORT_FIELDS.map(function (f) {
        return '<label class="field"><span>' + esc(L.FIELD_LABEL[f]) + '</span><select data-f="' + f + '">' + opts(f) + '</select></label>';
      }).join('') + '</div><p class="small muted" style="margin-top:8px">' + rows.length + '행 · 첫 행 예: ' + esc(JSON.stringify(rows[0]).slice(0, 160)) + '</p>';
    App.dialog('도면 대장 가져오기 — 열 맞추기', html, [{ label: '취소', value: 'cancel' }, { label: '가져오기', value: 'ok', primary: true }]).then(function (v) {
      if (v !== 'ok') return;
      var m = {};
      $$('#dialogContent select[data-f]').forEach(function (s) { m[s.getAttribute('data-f')] = s.value; });
      var r = L.importRows(App.db, rows, m, new Date());
      App.save();
      App.dialog('가져오기 결과', '<p>' + r.added + '건을 추가했습니다.</p>' + (r.skipped.length ? '<p>건너뜀 ' + r.skipped.length + '건</p><ul class="small">' +
        r.skipped.slice(0, 20).map(function (s) { return '<li>' + s.row + '행 — ' + esc(s.reason) + '</li>'; }).join('') + '</ul>' : ''), [{ label: '확인', value: 'ok', primary: true }]);
      App.rerender();
    });
    var ms = document.getElementById('mapSheet');
    if (ms) ms.addEventListener('change', function () { document.getElementById('dialog').close('cancel'); setTimeout(function () { showMapping(book, ms.value, names); }, 0); });
  }

  // ── 도면 상세 ──────────────────────────
  App.view('drawing', function (main, parts) {
    var db = App.db, d = L.findBy(db.drawings, parts[0]);
    if (!d) { main.innerHTML = '<div class="warn-box">도면을 찾을 수 없습니다.</div><a href="#/search">검색으로</a>'; return; }
    var g = L.findBy(db.groups, d.groupId);
    var ecns = db.ecns.filter(function (e) { return e.drawingBeforeId === d.id || e.drawingAfterId === d.id || e.partNoAfter === d.partNo || e.partNoBefore === d.partNo; });
    var groupEcns = g ? db.ecns.filter(function (e) { return ecns.indexOf(e) < 0 && L.ecnGroupId(db, e) === g.id; }) : [];
    var decs = db.decisions.filter(function (x) { return x.drawingId === d.id; });
    var mats = [];
    ecns.forEach(function (e) { (e.materials || []).forEach(function (m) { if (m.type) mats.push({ e: e, m: m }); }); });
    var h = '<div class="page-head"><h1>도면 상세 · ' + esc(App.drawingLabel(d)) + '</h1><div class="actions">' +
      '<a class="btn" href="#/register/' + d.id + '">추출정보 수정</a><a class="btn" href="#/similar/' + d.id + '">유사도 결과</a>' +
      '<a class="btn btn-primary" href="#/ecn/new?drawing=' + d.id + '">ECN 등록</a></div></div>';
    h += '<div class="two-col"><div class="card"><h2>도면 정보</h2><dl class="kv">' +
      ['id', 'fileName', 'partNo', 'partName', 'rev', 'customer', 'model', 'usage', 'dwgDate', 'regDate', 'connectors', 'circuits', 'branches', 'wires', 'keywords'].map(function (k) {
        return '<dt>' + esc(k === 'id' ? '도면 ID' : L.FIELD_LABEL[k]) + '</dt><dd>' + esc(d[k] == null ? '' : d[k]) + '</dd>';
      }).join('') + '<dt>상태</dt><dd>' + App.statusBadge(L.drawingStatus(d)) + '</dd></dl></div>';
    h += '<div class="card"><h2>그룹</h2>' + (g ? '<p><a href="#/groups?g=' + g.id + '">' + esc(g.id + ' ' + g.name) + '</a><br><span class="small muted">대표도면 ' + esc(g.repDrawingId) +
      ' · 확정 ' + esc((d.confirmedBy || g.confirmedBy) + ' ' + (d.confirmedAt || g.confirmedAt)) + '</span></p>' : '<p class="muted">아직 그룹이 확정되지 않았습니다. <a href="#/similar/' + d.id + '">유사 후보 확인 →</a></p>') +
      '<h3>판단 이력</h3>' + App.table([{ label: '일시', key: 'at' }, { label: '처리', key: 'action' }, { label: '그룹', key: 'groupId' }, { label: '확정자', key: 'by' }, { label: '메모', key: 'memo' }], decs, { empty: '기록 없음' }) + '</div></div>';
    h += '<div class="card"><h2>ECN 이력</h2>' + ecnMini(ecns, '이 도면에 연결된 ECN 이 없습니다.') +
      (groupEcns.length ? '<h3 style="margin-top:12px">같은 그룹의 ECN (수평전개 참고)</h3>' + ecnMini(groupEcns, '') : '') + '</div>';
    h += '<div class="card"><h2>변경자재 이력</h2>' + App.table([
      { label: 'ECN', render: function (x) { return '<a href="#/ecn/' + x.e.id + '">' + esc(x.e.ecnNo) + '</a>'; } },
      { label: '변경 유형', render: function (x) { return esc(x.m.type); } },
      { label: '변경 전', render: function (x) { return esc([x.m.beforeNo, x.m.beforeSpec].filter(Boolean).join(' ')); } },
      { label: '변경 후', render: function (x) { return esc([x.m.afterNo, x.m.afterSpec].filter(Boolean).join(' ')); } },
      { label: '재고 처리', render: function (x) { return esc(x.m.stock); } },
      { label: '담당 부서', render: function (x) { return esc(x.m.dept); } }
    ], mats, { empty: '변경자재 기록이 없습니다.' }) + '</div>';
    main.innerHTML = h;
  });
  function ecnMini(list, empty) {
    return App.table([
      { label: 'ECN 번호', render: function (e) { return '<a href="#/ecn/' + e.id + '">' + esc(e.ecnNo) + '</a>'; } },
      { label: '상태', render: function (e) { return App.statusBadge(e.status); } },
      { label: 'REV', render: function (e) { return esc((e.revBefore || '') + ' → ' + (e.revAfter || '')); } },
      { label: '변경 목적', key: 'purpose' },
      { label: '제품 적용일', key: 'applyDate' }
    ], list, { empty: empty });
  }
})(window);
