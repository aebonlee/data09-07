/* 화면 ③ 유사도 결과 · 그룹 확정, 유사 후보 적중 검증(양식 14), 도면 그룹(양식 4) */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  function weightLine(s) {
    return '가중치 · ' + L.WEIGHT_KEYS.map(function (k) { return L.WEIGHT_SHORT[k] + ' ' + s.weights[k]; }).join(' · ');
  }

  // ── 유사도 분석 목록 + 적중 검증 ──────────────
  App.view('similar', function (main, parts) {
    if (parts[0]) return detail(main, parts[0]);
    var db = App.db, s = db.settings;
    var rows = db.drawings.map(function (d) {
      var c = L.rankCandidates(d, db.drawings, s);
      return { d: d, c: c, cls: L.classify(c, s.threshold) };
    });
    var hit = L.hitCheck(db, 3);
    var h = '<div class="page-head"><h1>유사도 분석</h1><div class="actions">' +
      '<button type="button" class="btn" id="exp3">3 유사도 분석 결과표 (엑셀)</button>' +
      '<button type="button" class="btn" id="exp14">14 유사 후보 적중 검증표 (엑셀)</button></div></div>' +
      '<p class="principle">' + esc(weightLine(s)) + ' · 기준점수 ' + esc(s.threshold) + ' · 상위 ' + esc(s.topN) + '건 · 비교 범위 ' + (s.scope === 'sameCustomer' ? '동일 고객사' : '전체') + ' — <a href="#/settings">설정에서 조정</a></p>';
    if (L.weightSum(s.weights) !== 100) h += '<div class="warn-box small">가중치 합계가 ' + L.weightSum(s.weights) + ' 입니다. 총점 만점이 100이 되도록 설정에서 맞추는 것을 권합니다.</div>';
    h += '<div class="card"><h2>도면별 1순위 후보</h2>' + App.table([
      { label: '도면', render: function (r) { return '<a href="#/similar/' + r.d.id + '">' + esc(App.drawingLabel(r.d) || r.d.id) + '</a>'; } },
      { label: '고객사 · 기종 · 사용처', render: function (r) { return esc([r.d.customer, r.d.model, r.d.usage].filter(Boolean).join(' · ')); } },
      { label: '상태', render: function (r) { return App.statusBadge(L.drawingStatus(r.d)); } },
      { label: '1순위 후보', render: function (r) { return r.c[0] ? esc(r.c[0].partNo + ' · ' + r.c[0].total + '점') : '-'; } },
      { label: '판정', render: function (r) { return esc(r.cls.text); } },
      { label: '', render: function (r) { return '<a class="btn btn-sm" href="#/similar/' + r.d.id + '">후보 확인 →</a>'; } }
    ], rows, { empty: '도면이 없습니다. 도면 등록에서 PDF 를 올리세요.' }) + '</div>';
    // 양식 14
    var gOpts = function (v) {
      return '<option value="">(미입력)</option><option value="신규"' + (v === '신규' ? ' selected' : '') + '>신규 그룹</option>' +
        db.groups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (v === g.id ? ' selected' : '') + '>' + esc(g.id + ' ' + g.name) + '</option>'; }).join('');
    };
    var byId = {}; hit.rows.forEach(function (r) { byId[r.drawingId] = r; });
    h += '<div class="card"><h2>유사 후보 적중 검증 (양식 14)</h2>' +
      '<p class="small">도면마다 담당자가 판단한 정답 그룹을 고르면, 상위 3개 후보의 그룹에 정답이 들어 있는지 셉니다. 정답이 「신규 그룹」이면 1순위 점수가 기준점수 미만일 때 적중으로 봅니다(가정). 원문 교육단계 목표는 적중률 70퍼센트 이상입니다.</p>' +
      '<div class="' + (hit.rate == null ? 'note' : (hit.rate >= 70 ? 'ok-box' : 'warn-box')) + '">평가 ' + hit.total + '건 · 적중 ' + hit.hits + '건 · 적중률 ' + (hit.rate == null ? '-' : hit.rate + '%') + ' (목표 70% 이상)</div>' +
      App.table([
        { label: '도면', render: function (d) { return esc(App.drawingLabel(d) || d.id); } },
        { label: '담당자 정답 그룹', render: function (d) { return '<select data-ans="' + d.id + '">' + gOpts(d.answerGroup || '') + '</select>'; } },
        { label: '상위 3개 후보', render: function (d) { var r = byId[d.id]; return r ? esc(r.cands.map(function (c) { return c.partNo + '(' + c.total + '·' + (c.groupId || '미분류') + ')'; }).join(', ')) : ''; } },
        { label: '적중', render: function (d) { var r = byId[d.id]; return r ? App.statusBadge(r.hit ? '적중' : '미적중') + (r.hitRank ? ' <span class="small">' + esc(r.hitRank) + (typeof r.hitRank === 'number' ? '순위' : '') + '</span>' : '') : ''; } }
      ], db.drawings, { empty: '도면이 없습니다.' }) + '</div>';
    main.innerHTML = h;
    $$('select[data-ans]', main).forEach(function (sel) {
      sel.addEventListener('change', function () {
        var d = L.findBy(db.drawings, sel.getAttribute('data-ans'));
        d.answerGroup = sel.value; App.save(); App.rerender();
      });
    });
    $('#exp3', main).addEventListener('click', function () {
      App.downloadXlsx('3_유사도분석결과표', [{ name: '3_유사도분석결과표', rows: L.sheetSimilarity(db) }]);
    });
    $('#exp14', main).addEventListener('click', function () {
      App.downloadXlsx('14_유사후보적중검증표', [{ name: '14_유사후보적중검증표', rows: L.sheetHitCheck(db) }]);
    });
  });

  // ── 유사도 결과 · 그룹 확정 (도면 1건) ─────────
  function detail(main, id) {
    var db = App.db, s = db.settings, d = L.findBy(db.drawings, id);
    if (!d) { main.innerHTML = '<div class="warn-box">도면을 찾을 수 없습니다.</div>'; return; }
    var miss = L.missingFields(d);
    if (miss.length) {
      main.innerHTML = '<div class="page-head"><h1>유사도 결과 · 그룹 확정</h1></div>' + App.stepsBar(2) +
        '<div class="warn-box">정보가 충분하지 않습니다 — ' + esc(miss.map(function (k) { return L.FIELD_LABEL[k]; }).join(', ')) + ' 미인식. 보정 후 다시 분석하세요.</div>' +
        '<a class="btn btn-primary" href="#/register/' + d.id + '">추출정보 수정 →</a>';
      return;
    }
    if (!d.analyzedAt) { d.analyzedAt = L.toDateTimeStr(new Date()); App.save(); }
    var cands = L.rankCandidates(d, db.drawings, s);
    var cls = L.classify(cands, s.threshold);
    var selId = App.ui.simSel && App.ui.simSel.d === d.id ? App.ui.simSel.c : (cands[0] ? cands[0].id : '');
    var sel = cands.filter(function (c) { return c.id === selId; })[0] || cands[0];
    var cd = sel ? L.findBy(db.drawings, sel.id) : null;
    var curG = L.findBy(db.groups, d.groupId);
    var h = '<div class="page-head"><h1>유사도 결과 · 그룹 확정</h1><div class="actions"><a class="btn" href="#/register/' + d.id + '">추출정보 수정</a></div></div>' +
      App.stepsBar(d.groupId ? 4 : 3) + '<div class="sim-grid">';
    // 기준 도면
    h += '<div class="sim-left"><div class="card"><h2>기준 도면</h2><dl class="kv">' +
      '<dt>품번</dt><dd>' + esc(App.drawingLabel(d)) + '</dd><dt>품명</dt><dd>' + esc(d.partName) + '</dd><dt>고객사</dt><dd>' + esc(d.customer) + '</dd>' +
      '<dt>기종</dt><dd>' + esc(d.model) + '</dd><dt>사용처</dt><dd>' + esc(d.usage) + '</dd>' +
      '<dt>특징</dt><dd>' + esc(featureText(d)) + '</dd></dl>' +
      (curG ? '<div class="ok-box small" style="margin-top:10px">현재 그룹 ' + esc(curG.id + ' ' + curG.name) + ' · ' + esc((d.confirmedBy || '') + ' ' + (d.confirmedAt || '')) + '</div>' : '') +
      '</div></div>';
    // 후보
    h += '<div class="sim-center"><div class="card"><h2>AI 추천 후보 상위 ' + cands.length + '건</h2><p class="small muted">' + esc(weightLine(s)) + '</p>' +
      '<div class="' + (cls.kind === 'existing' ? 'note' : 'warn-box') + ' small">' + esc(cls.text) + '</div>';
    if (!cands.length) h += '<p class="muted">비교할 도면이 없습니다. 도면을 더 등록하거나 비교 범위를 넓히세요.</p>';
    cands.forEach(function (c) {
      var o = L.findBy(db.drawings, c.id);
      h += '<div class="cand' + (sel && c.id === sel.id ? ' sel' : '') + '" data-c="' + c.id + '" tabindex="0" role="button"><div class="cand-head"><div><strong>' + c.rank + ' · ' + esc(App.drawingLabel(o)) + '</strong><br>' +
        '<span class="small muted">' + esc([o.partName, o.customer, o.model, o.groupId ? '그룹 ' + o.groupId : '미분류'].filter(Boolean).join(' · ')) + '</span></div>' +
        '<div class="cand-score' + (c.total < L.toNum(s.threshold) ? ' low' : '') + '">' + c.total + '</div></div><div class="bars">' +
        L.WEIGHT_KEYS.map(function (k) {
          var w = L.toNum(s.weights[k]) || 0, v = c.items[k];
          return '<div class="bar"><span>' + L.WEIGHT_SHORT[k] + '</span><span class="bar-track"><span class="bar-fill" style="width:' + (w ? Math.round(v / w * 100) : 0) + '%"></span></span><span class="small">' + v + '/' + w + '</span></div>';
        }).join('') + '</div></div>';
    });
    h += '<p class="small muted">기준점수 ' + esc(s.threshold) + ' · 미만 후보는 신규 그룹 검토 대상</p>';
    if ((d.excluded || []).length) h += '<p class="small">제외한 후보: ' + esc(d.excluded.join(', ')) + ' <button type="button" class="btn btn-sm" id="restoreEx">제외 되돌리기</button></p>';
    h += '</div></div>';
    // 비교 패널 + 그룹 처리 + 승인
    h += '<div class="sim-right"><div class="card">';
    if (cd) {
      var cmp = L.compareDrawings(d, cd);
      h += '<h2>비교 패널</h2><p class="small">' + esc(d.partNo + ' ' + (d.rev || '') + ' ↔ ' + cd.partNo + ' ' + (cd.rev || '')) + '</p>' +
        '<h3>공통</h3><ul class="cmp-list">' + (cmp.common.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') || '<li class="muted">없음</li>') + '</ul>' +
        '<h3>차이</h3><ul class="cmp-list">' + (cmp.diff.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') || '<li class="muted">없음</li>') + '</ul>' +
        '<h3>점수 근거</h3><ul class="cmp-list small">' + L.WEIGHT_KEYS.map(function (k) { return '<li>' + esc(L.WEIGHT_SHORT[k] + ' ' + sel.items[k] + ' — ' + sel.notes[k]) + '</li>'; }).join('') + '</ul>';
    }
    var cg = cd ? L.findBy(db.groups, cd.groupId) : null;
    var linkTo = cg ? cg.id : (cls.kind === 'existing' ? cls.groupId : '');
    var defaultAction = linkTo ? 'link' : 'new';
    h += '<h2 style="margin-top:12px">그룹 처리</h2><div class="radio-list">' +
      '<label><input type="radio" name="act" value="link"' + (defaultAction === 'link' ? ' checked' : '') + (db.groups.length ? '' : ' disabled') + '> <span>기존 그룹 연결 <select id="linkG" style="width:auto;min-height:32px">' +
      db.groups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (linkTo === g.id ? ' selected' : '') + '>' + esc(g.id + ' ' + g.name) + '</option>'; }).join('') + '</select>' +
      (cg ? '<br><span class="small muted">대표도면 ' + esc(cg.repDrawingId) + ' · 관련 ECN ' + db.ecns.filter(function (e) { return L.ecnGroupId(db, e) === cg.id; }).length + '건</span>' : '') + '</span></label>' +
      '<label><input type="radio" name="act" value="new"' + (defaultAction === 'new' ? ' checked' : '') + '> <span>신규 그룹 생성</span></label></div>' +
      '<div id="newBox" class="form-grid"><label class="field wide"><span>신규 그룹명</span><input type="text" id="newName" value="' + esc([d.customer, d.model, d.usage].filter(Boolean).join(' ') + ' 계열') + '"></label>' +
      '<label class="field wide"><span>분류기준</span><input type="text" id="newCrit" value="고객사·기종·사용처 동일"></label>' +
      (cd && !cd.groupId && sel.total >= L.toNum(s.threshold) ? '<label class="wide small"><input type="checkbox" id="withCand" checked> 선택한 후보 ' + esc(cd.partNo) + ' (미분류)도 이 그룹에 넣기</label>' : '') + '</div>' +
      (cd ? '<p style="margin-top:8px"><button type="button" class="btn btn-sm btn-danger" id="exclude">이 후보 제외</button></p>' : '') +
      '<h2 style="margin-top:12px">승인 기록</h2><div class="form-grid"><label class="field"><span>확정자</span><input type="text" id="by" value="' + esc(s.approver || '') + '" placeholder="이름"></label>' +
      '<p class="small muted" style="align-self:end">저장 시 일시 자동 기록</p>' +
      '<label class="field wide"><span>판단 메모</span><textarea id="memo" placeholder="예: OPT-2 회로 추가 외 구성 동일 — 동일 계열로 판단"></textarea></label></div>' +
      '<div class="actions" style="margin-top:10px"><button type="button" class="btn" id="approve">승인 및 저장</button>' +
      '<button type="button" class="btn btn-primary" id="approveEcn">승인 및 저장 → ECN 연결</button></div></div></div></div>';
    main.innerHTML = h;
    $$('.cand', main).forEach(function (el) {
      function pick() { App.ui.simSel = { d: d.id, c: el.getAttribute('data-c') }; App.rerender(); }
      el.addEventListener('click', pick);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    var rb = $('#restoreEx', main);
    if (rb) rb.addEventListener('click', function () { d.excluded = []; App.save(); App.rerender(); });
    var ex = $('#exclude', main);
    if (ex) ex.addEventListener('click', function () {
      L.excludeCandidate(db, d.id, cd.id, $('#by', main).value.trim(), new Date());
      App.ui.simSel = null; App.save(); App.toast(cd.partNo + ' 를 후보에서 제외했습니다.'); App.rerender();
    });
    function syncBox() { $('#newBox', main).hidden = $('input[name=act]:checked', main).value !== 'new'; }
    $$('input[name=act]', main).forEach(function (r) { r.addEventListener('change', syncBox); });
    syncBox();
    function approve(toEcn) {
      var act = $('input[name=act]:checked', main).value;
      var by = $('#by', main).value.trim();
      var w = $('#withCand', main);
      try {
        var gid = L.confirmGroup(db, d.id, {
          action: act, groupId: $('#linkG', main) ? $('#linkG', main).value : '', name: $('#newName', main).value, criteria: $('#newCrit', main).value,
          by: by, memo: $('#memo', main).value.trim(), candidateId: cd ? cd.id : '', score: sel ? sel.total : '',
          withIds: act === 'new' && w && w.checked ? [cd.id] : []
        }, new Date());
        if (by && !s.approver) s.approver = by;
        App.save();
        App.toast('그룹 ' + gid + ' 로 확정했습니다.');
        App.go(toEcn ? '#/ecn/new?drawing=' + d.id : '#/drawing/' + d.id);
      } catch (e) { App.toast(e.message); }
    }
    $('#approve', main).addEventListener('click', function () { approve(false); });
    $('#approveEcn', main).addEventListener('click', function () { approve(true); });
  }
  function featureText(d) {
    var a = [];
    var n = L.splitList(d.connectors).length;
    if (n) a.push('커넥터 ' + n + '종');
    if (d.circuits !== '' && d.circuits != null) a.push('회로 ' + d.circuits);
    if (d.branches !== '' && d.branches != null) a.push('분기 ' + d.branches);
    if (d.keywords) a.push(d.keywords);
    return a.join(', ');
  }

  // ── 도면 그룹 (양식 4) ──────────────────────
  App.view('groups', function (main, parts, q) {
    var db = App.db;
    var h = '<div class="page-head"><h1>도면 그룹</h1><div class="actions"><button type="button" class="btn" id="exp4">4 도면 그룹 목록 (엑셀)</button></div></div>';
    if (!db.groups.length) h += '<div class="note">확정된 그룹이 없습니다. 유사도 분석에서 도면을 고르고 「신규 그룹 생성」으로 첫 그룹을 만드세요.</div>';
    db.groups.forEach(function (g) {
      var mem = db.drawings.filter(function (d) { return d.groupId === g.id; });
      var ecns = db.ecns.filter(function (e) { return L.ecnGroupId(db, e) === g.id; });
      h += '<div class="card" id="g-' + esc(g.id) + '"' + (q.g === g.id ? ' style="border-color:var(--primary)"' : '') + '><div class="page-head"><h2 style="margin:0">' + esc(g.id + ' · ' + g.name) + '</h2>' +
        '<button type="button" class="btn btn-sm" data-edit="' + esc(g.id) + '">수정</button></div>' +
        '<p class="small muted">대표도면 ' + esc(g.repDrawingId) + ' · 분류기준 ' + esc(g.criteria || '-') + ' · 확정 ' + esc((g.confirmedBy || '') + ' ' + (g.confirmedAt || '')) + (g.memo ? ' · ' + esc(g.memo) : '') + '</p>' +
        App.table([
          { label: '도면', render: function (d) { return '<a href="#/drawing/' + d.id + '">' + esc(App.drawingLabel(d)) + '</a>' + (d.id === g.repDrawingId ? ' <span class="badge b-info">대표</span>' : ''); } },
          { label: '품명', key: 'partName' }, { label: '고객사', key: 'customer' }, { label: '기종', key: 'model' }, { label: '사용처', key: 'usage' },
          { label: '확정', render: function (d) { return esc((d.confirmedBy || '') + ' ' + (d.confirmedAt || '')); } }
        ], mem, { empty: '소속 도면 없음' }) +
        (ecns.length ? '<p class="small" style="margin-top:8px">관련 ECN: ' + ecns.map(function (e) { return '<a href="#/ecn/' + e.id + '">' + esc(e.ecnNo) + '</a>'; }).join(', ') + '</p>' : '') + '</div>';
    });
    h += '<div class="card"><h2>그룹 판단 이력</h2>' + App.table([
      { label: '일시', key: 'at' }, { label: '도면', key: 'drawingId' }, { label: '처리', key: 'action' }, { label: '그룹', key: 'groupId' },
      { label: '이전 그룹', key: 'prevGroupId' }, { label: '후보', key: 'candidateId' }, { label: '점수', key: 'score' }, { label: '확정자', key: 'by' }, { label: '메모', key: 'memo' }
    ], db.decisions.slice().reverse(), { empty: '기록 없음' }) + '</div>';
    main.innerHTML = h;
    if (q.g) { var t = document.getElementById('g-' + q.g); if (t) t.scrollIntoView(); }
    $('#exp4', main).addEventListener('click', function () {
      App.downloadXlsx('4_도면그룹목록', [{ name: '4_도면그룹목록', rows: L.sheetGroups(db) }]);
    });
    $$('[data-edit]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        var g = L.findBy(db.groups, b.getAttribute('data-edit'));
        var mem = db.drawings.filter(function (d) { return d.groupId === g.id; });
        App.dialog('그룹 수정 · ' + g.id, '<div class="form-grid"><label class="field wide"><span>그룹명</span><input type="text" id="gName" value="' + esc(g.name) + '"></label>' +
          '<label class="field wide"><span>분류기준</span><input type="text" id="gCrit" value="' + esc(g.criteria || '') + '"></label>' +
          '<label class="field wide"><span>대표도면</span><select id="gRep">' + mem.map(function (d) { return '<option value="' + d.id + '"' + (d.id === g.repDrawingId ? ' selected' : '') + '>' + esc(d.id + ' ' + App.drawingLabel(d)) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field wide"><span>메모</span><textarea id="gMemo">' + esc(g.memo || '') + '</textarea></label></div>',
          [{ label: '취소', value: 'cancel' }, { label: '저장', value: 'ok', primary: true }]).then(function (v) {
          if (v !== 'ok') return;
          g.name = $('#gName').value.trim() || g.name; g.criteria = $('#gCrit').value.trim(); g.memo = $('#gMemo').value.trim();
          if ($('#gRep').value) g.repDrawingId = $('#gRep').value;
          App.save(); App.rerender();
        });
      });
    });
  });
})(window);
