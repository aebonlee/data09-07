/* 화면 ④ ECN 관리 · 변경자재 — 설계변경통보서 양식(docs/source/03_…xlsx) 항목을 따릅니다 */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  // ── ECN 목록 ────────────────────────────
  App.view('ecn', function (main, parts, q) {
    if (parts[0]) return form(main, parts[0], q);
    var db = App.db, today = App.today();
    var st = q.status || '';
    var list = L.searchEcns(db.ecns, q.text || '').filter(function (e) { return !st || e.status === st; });
    var h = '<div class="page-head"><h1>ECN 관리</h1><div class="actions"><a class="btn btn-primary" href="#/ecn/new">ECN 등록</a>' +
      '<button type="button" class="btn" id="exp5">5 ECN 요약표 (엑셀)</button><button type="button" class="btn" id="expAct">부서별 조치사항 (엑셀)</button></div></div>' +
      '<form class="card form-grid" id="ecnFilter"><label class="field"><span>검색어</span><input type="text" name="text" value="' + esc(q.text || '') + '" placeholder="ECN 번호 · 품번 · 고객사 · 자재품번"></label>' +
      '<label class="field"><span>상태</span><select name="status"><option value="">전체</option>' + L.ECN_STATUS.map(function (s) { return '<option' + (s === st ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<div style="align-self:end"><button class="btn" type="submit">조회</button></div></form>';
    h += App.table([
      { label: 'ECN 번호', render: function (e) { return '<a href="#/ecn/' + e.id + '">' + esc(e.ecnNo || '(번호 없음)') + '</a>'; } },
      { label: '상태', render: function (e) { return App.statusBadge(e.status) + (L.ecnDelayed(e, today) ? ' ' + App.statusBadge('지연') : ''); } },
      { label: '고객사', key: 'customer' },
      { label: '대상 품번', render: function (e) { return esc(e.partNoAfter || e.partNoBefore); } },
      { label: 'REV', render: function (e) { return esc((e.revBefore || '') + ' → ' + (e.revAfter || '')); } },
      { label: '설계 변경 목적', key: 'purpose' },
      { label: '제품 적용일', render: function (e) { return esc(e.applyDate || '미정'); } },
      { label: '변경자재', render: function (e) { var c = L.typeCounts(e.materials); return esc(L.CHANGE_TYPES.filter(function (t) { return c[t]; }).map(function (t) { return t + ' ' + c[t]; }).join(' · ') || '없음'); } },
      { label: '종결 판정', render: function (e) { return App.statusBadge(e.status === '완료' ? '완료' : L.closureCheck(e).verdict); } }
    ], list, { empty: 'ECN 이 없습니다. 「ECN 등록」으로 추가하세요.' });
    main.innerHTML = h;
    $('#ecnFilter', main).addEventListener('submit', function (ev) {
      ev.preventDefault();
      App.go('#/ecn?text=' + encodeURIComponent(this.text.value.trim()) + '&status=' + encodeURIComponent(this.status.value));
    });
    $('#exp5', main).addEventListener('click', function () {
      App.downloadXlsx('5_ECN요약표', [{ name: '5_ECN요약표', rows: L.sheetEcnSummary(db, today) }]);
    });
    $('#expAct', main).addEventListener('click', function () {
      App.downloadXlsx('부서별조치사항', [{ name: '부서별조치사항', rows: L.sheetActions(db, today) }]);
    });
  });

  // ── ECN 1건 (등록·수정) ────────────────────
  function fillFromDrawing(e, d) {
    if (!d) return;
    if (!e.partNoBefore) e.partNoBefore = d.partNo || '';
    if (!e.partNoAfter) e.partNoAfter = d.partNo || '';
    if (!e.revBefore) e.revBefore = d.rev || '';
    if (!e.model) e.model = d.model || '';
    if (!e.customer) e.customer = d.customer || '';
    if (!e.partName) e.partName = d.partName || '';
    if (!e.groupId && d.groupId) e.groupId = d.groupId;
  }

  function form(main, id, q) {
    var db = App.db, today = App.today();
    var isNew = id === 'new';
    var e;
    if (isNew) {
      if (!App.ui.ecnDraft || (q.drawing && App.ui.ecnDraft._for !== q.drawing)) {
        e = L.emptyEcn();
        e._for = q.drawing || '';
        e.writtenDate = L.toDateStr(today);
        e.receivedDate = L.toDateStr(today);
        e.approval.writer = db.settings.approver || '';
        if (q.drawing) { e.drawingBeforeId = q.drawing; fillFromDrawing(e, L.findBy(db.drawings, q.drawing)); }
        App.ui.ecnDraft = e;
      }
      e = App.ui.ecnDraft;
    } else {
      e = L.findBy(db.ecns, id);
      if (!e) { main.innerHTML = '<div class="warn-box">ECN 을 찾을 수 없습니다.</div><a href="#/ecn">목록으로</a>'; return; }
    }
    var c = L.closureCheck(e);
    var dOpts = function (v) {
      return '<option value="">(선택 안 함)</option>' + db.drawings.map(function (d) { return '<option value="' + d.id + '"' + (d.id === v ? ' selected' : '') + '>' + esc(d.id + ' · ' + App.drawingLabel(d)) + '</option>'; }).join('');
    };
    var gOpts = '<option value="">(없음)</option>' + db.groups.map(function (g) { return '<option value="' + g.id + '"' + (g.id === L.ecnGroupId(db, e) ? ' selected' : '') + '>' + esc(g.id + ' ' + g.name) + '</option>'; }).join('');
    function inp(k, label, type, ph) {
      return '<label class="field"><span>' + esc(label) + '</span><input type="' + (type || 'text') + '" data-k="' + k + '" value="' + esc(e[k] == null ? '' : e[k]) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></label>';
    }
    function ta(k, label, wide) {
      return '<label class="field' + (wide ? ' wide' : '') + '"><span>' + esc(label) + '</span><textarea data-k="' + k + '">' + esc(e[k] || '') + '</textarea></label>';
    }
    function sel(k, label, opts) {
      return '<label class="field"><span>' + esc(label) + '</span><select data-k="' + k + '">' + opts.map(function (o) { return '<option' + (o === e[k] ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>';
    }
    var h = '<div id="ecnForm"><div class="page-head"><h1>ECN 관리 · ' + (isNew ? '새 ECN' : esc(e.ecnNo)) + ' ' + (isNew ? '' : App.statusBadge(e.status)) + '</h1><div class="actions">' +
      (isNew ? '<button type="button" class="btn btn-primary" id="saveNew">등록</button>' :
        '<button type="button" class="btn" id="expReport">엑셀 출력 (설계변경통보서)</button>' +
        (e.status === '완료' ? '<button type="button" class="btn" id="reopen">진행 중으로 되돌리기</button>' : '<button type="button" class="btn btn-primary" id="complete">ECN 완료 처리</button>') +
        '<button type="button" class="btn btn-danger btn-sm" id="delEcn">삭제</button>') + '</div></div>' +
      (isNew ? App.stepsBar(5) + '<p class="small muted">번호와 내용을 넣고 「등록」을 누르면 저장됩니다. 등록한 뒤에는 고칠 때마다 자동 저장됩니다.</p>' : '<p class="small muted">고칠 때마다 자동 저장됩니다. 작성 ' + esc(e.createdAt || '') + (e.completedAt ? ' · 완료 ' + esc(e.completedAt) : '') + '</p>') +
      '<div id="closureBanner">' + closureBanner(e, c) + '</div>';
    // 1. 기본 정보
    h += '<section class="card ecn-sec"><h2>ECN 기본정보 · 1. 기본 정보</h2><div class="form-grid">' +
      inp('ecnNo', 'ECN 번호 (필수)', 'text', '예: ECN-2026-0922-01') + inp('docClass', '문서분류') + inp('writtenDate', '작성 일자', 'date') +
      inp('changeKind', '설변 종류', 'text', '예: 선적용 / 정규') + inp('receivedDate', '접수일(요청일)', 'date') + inp('revNo', '개정 번호', 'number') +
      inp('model', '기종') + inp('partNoAfter', '품번 (변경 후)') + inp('partNoBefore', '변경 전 품번') +
      inp('partName', '품명') + inp('customer', '고객사') + inp('customerContact', '고객 담당자') +
      inp('reasonType', '변경 사유 구분', 'text', '예: 고객 요청') + inp('revBefore', '도면 REV (전)') + inp('revAfter', '도면 REV (후)') +
      inp('requestSource', '요청 출처') + '<label class="field wide"><span>설계 변경 목적</span><input type="text" data-k="purpose" value="' + esc(e.purpose || '') + '"></label>' +
      '</div><h3 style="margin-top:12px">결재</h3><div class="form-grid">' +
      [['writer', '작성'], ['reviewer', '검토'], ['approver', '승인'], ['receiver', '접수(품질)']].map(function (p) {
        return '<label class="field"><span>' + p[1] + '</span><input type="text" data-ap="' + p[0] + '" value="' + esc(e.approval[p[0]] || '') + '"></label>';
      }).join('') + '</div></section>';
    // 도면 연결
    var dB = L.findBy(db.drawings, e.drawingBeforeId), dA = L.findBy(db.drawings, e.drawingAfterId), gid = L.ecnGroupId(db, e);
    h += '<section class="card ecn-sec"><h2>도면 연결</h2><div class="form-grid">' +
      '<label class="field"><span>변경 전 도면</span><select data-k="drawingBeforeId" data-re="1">' + dOpts(e.drawingBeforeId) + '</select></label>' +
      '<label class="field"><span>변경 후 도면</span><select data-k="drawingAfterId" data-re="1">' + dOpts(e.drawingAfterId) + '</select></label>' +
      '<label class="field"><span>유사 그룹</span><select data-k="groupId" data-re="1">' + gOpts + '</select></label></div>' +
      '<p class="small" style="margin-top:8px">' + (dB ? '<a href="#/drawing/' + dB.id + '">변경 전 ' + esc(App.drawingLabel(dB)) + ' 열기</a> · ' : '') +
      (dA ? '<a href="#/drawing/' + dA.id + '">변경 후 ' + esc(App.drawingLabel(dA)) + ' 열기</a> · ' : '') +
      (gid ? '<a href="#/groups?g=' + gid + '">유사 그룹 ' + esc(gid + ' ' + L.groupName(db, gid)) + ' 열기</a>' : '<span class="muted">도면을 고르면 그 도면의 그룹이 연결됩니다.</span>') + '</p></section>';
    // 2
    h += '<section class="card ecn-sec"><h2>2. 변경 내용 요약</h2><div class="two-col">' + ta('beforeText', '변경 전 (요청 내용)') + ta('afterText', '변경 후 (요청 사유 · 변경 내용)') + '</div></section>';
    // 3, 4
    h += '<div class="two-col"><section class="card ecn-sec"><h2>3. 적용 시점 및 재고 처리</h2><div class="form-grid">' +
      inp('applyDate', '제품 적용일', 'date') + inp('deliveryApply', '납품 적용일', 'text', '예: 10월 납품분') + inp('applyCondition', '적용 조건', 'text', '예: 지정일 적용') +
      inp('applyLot', '적용 LOT·S/N') + inp('preApply', '선적용 여부', 'text', 'Y / N') + inp('regularDate', '정규 설변 예정일', 'date') +
      ta('stockPlan', '재고 처리 방안 (종합)', true) + '</div></section>' +
      '<section class="card ecn-sec"><h2>4. 수신 부서 확인</h2>' + App.table([
        { label: '수신 부서', render: function (r) { return esc(r.dept); } },
        { label: '확인자', render: function (r) { return '<input type="text" data-arr="receipts" data-i="' + r._i + '" data-f="person" value="' + esc(r.person) + '">'; } },
        { label: '확인일', render: function (r) { return '<input type="date" data-arr="receipts" data-i="' + r._i + '" data-f="date" value="' + esc(r.date) + '">'; } },
        { label: '비고', render: function (r) { return '<input type="text" data-arr="receipts" data-i="' + r._i + '" data-f="note" value="' + esc(r.note) + '">'; } }
      ], idx(e.receipts)) + '</section></div>';
    // 5 변경자재
    h += '<section class="card ecn-sec"><div class="page-head"><h2 style="margin:0">5. 변경자재 내역 — 신규 · 삭제 · 대체 · 수량변경 · 사양변경</h2>' +
      '<button type="button" class="btn btn-sm" id="addMat">+ 자재 추가</button></div>' + App.table([
        { label: 'No', render: function (m) { return m._i + 1; } },
        { label: '변경 유형', render: function (m) { return selCell('materials', m._i, 'type', m.type, [''].concat(L.CHANGE_TYPES)); } },
        { label: '적용 위치 (커넥터·회로)', render: function (m) { return txt('materials', m._i, 'location', m.location); } },
        { label: '변경 전 자재품번', render: function (m) { return txt('materials', m._i, 'beforeNo', m.beforeNo); } },
        { label: '변경 전 사양 (품명)', render: function (m) { return txt('materials', m._i, 'beforeSpec', m.beforeSpec); } },
        { label: '변경 전 수량', render: function (m) { return txt('materials', m._i, 'beforeQty', m.beforeQty, 'number'); } },
        { label: '단위', render: function (m) { return txt('materials', m._i, 'unit', m.unit); } },
        { label: '변경 후 자재품번', render: function (m) { return txt('materials', m._i, 'afterNo', m.afterNo); } },
        { label: '변경 후 사양 (품명)', render: function (m) { return txt('materials', m._i, 'afterSpec', m.afterSpec); } },
        { label: '변경 후 수량', render: function (m) { return txt('materials', m._i, 'afterQty', m.afterQty, 'number'); } },
        { label: '증감 (자동)', render: function (m) { return '<span data-delta="' + m._i + '">' + esc(L.materialDelta(m)) + '</span>'; } },
        { label: '재고 처리', render: function (m) { return txt('materials', m._i, 'stock', m.stock, 'text', '예: 소진 후 적용 / 미정'); } },
        { label: '담당 부서', render: function (m) { return txt('materials', m._i, 'dept', m.dept); } },
        { label: '현재고 (구자재)', render: function (m) { return txt('materials', m._i, 'currentStock', m.currentStock); } },
        { label: '', render: function (m) { return '<button type="button" class="btn btn-sm btn-danger" data-delmat="' + m._i + '">삭제</button>'; } }
      ], idx(e.materials), { empty: '변경자재가 없습니다. 「+ 자재 추가」로 넣으세요.' }) +
      '<p class="small" style="margin-top:8px">유형별 건수 (자동) · <span id="typeCounts">' + esc(L.typeCountText(e.materials)) + '</span> · 재고처리 미정 <span id="stockUnd">' + L.stockUndecided(e.materials) + '</span> 건</p></section>';
    // 6 영향도
    h += '<section class="card ecn-sec"><h2>6. 영향도 검토 및 부서별 조치</h2>' + App.table([
      { label: '검토 항목', render: function (r) { return esc(r.item); } },
      { label: '해당 여부', render: function (r) { return selCell('impacts', r._i, 'applies', r.applies, ['', '해당', '비해당']); } },
      { label: '변경 전 기록물 (번호·REV)', render: function (r) { return txt('impacts', r._i, 'beforeDoc', r.beforeDoc); } },
      { label: '변경 후 기록물 (번호·REV)', render: function (r) { return txt('impacts', r._i, 'afterDoc', r.afterDoc); } },
      { label: '조치 내용', render: function (r) { return txt('impacts', r._i, 'action', r.action); } },
      { label: '담당 부서', render: function (r) { return txt('impacts', r._i, 'dept', r.dept); } },
      { label: '담당자', render: function (r) { return txt('impacts', r._i, 'person', r.person); } },
      { label: '완료 예정일', render: function (r) { return txt('impacts', r._i, 'due', r.due, 'date'); } },
      { label: '완료일', render: function (r) { return txt('impacts', r._i, 'done', r.done, 'date'); } },
      { label: '상태 (자동)', render: function (r) { return '<span data-imp="' + r._i + '">' + App.statusBadge(L.impactStatus(r, today)) + '</span>'; } }
    ], idx(e.impacts)) + '</section>';
    // 7 수평전개
    h += '<section class="card ecn-sec"><div class="page-head"><h2 style="margin:0">7. 수평전개 검토 — 동일 그룹 · 유사 도면 · 공용 자재 적용 품번</h2><div class="actions">' +
      '<button type="button" class="btn btn-sm" id="loadHz">동일 그룹 · 유사 도면 불러오기</button><button type="button" class="btn btn-sm" id="addHz">+ 행 추가</button></div></div>' + App.table([
        { label: '대상 품번', render: function (r) { return txt('horizontal', r._i, 'partNo', r.partNo); } },
        { label: '기종', render: function (r) { return txt('horizontal', r._i, 'model', r.model); } },
        { label: '고객사', render: function (r) { return txt('horizontal', r._i, 'customer', r.customer); } },
        { label: '관계', render: function (r) { return txt('horizontal', r._i, 'relation', r.relation); } },
        { label: '적용 여부', render: function (r) { return selCell('horizontal', r._i, 'applies', r.applies, ['', '검토 중', '적용', '미적용']); } },
        { label: '검토 결과 · 사유', render: function (r) { return txt('horizontal', r._i, 'result', r.result); } },
        { label: '', render: function (r) { return '<button type="button" class="btn btn-sm btn-danger" data-delhz="' + r._i + '">삭제</button>'; } }
      ], idx(e.horizontal), { empty: '수평전개 대상이 없습니다. 「불러오기」로 동일 그룹·유사 도면(기준점수 이상)을 가져올 수 있습니다.' }) + '</section>';
    // 8 종결 + 9·10
    h += '<section class="card ecn-sec"><h2>8. ECN 종결 확인 (자동 판정)</h2><div id="closureBox">' + closureBox(c) + '</div>' +
      '<div class="form-grid" style="margin-top:10px">' + ta('remarks', '기타 / 특이 사항', true) + '</div></section>' +
      '<section class="card ecn-sec"><h2>9. 설계 변경 상세 · 10. 회의록</h2><p class="small muted">1단계 도구는 도면 캡처·사진을 저장하지 않습니다. 설명은 글로 남기고, 캡처는 내려받은 엑셀 9절에 붙여 넣으세요.</p><div class="two-col">' +
      ta('detailMemo', '9. 설계 변경 상세 (변경 전 / 변경 후 설명)') + ta('meetingMemo', '10. 회의록 / 협의 내용') + '</div></section></div>';
    main.innerHTML = h;
    wire(main, e, isNew);
  }

  function idx(arr) { return (arr || []).map(function (x, i) { var o = Object.assign({}, x); o._i = i; return o; }); }
  function txt(arr, i, f, v, type, ph) {
    return '<input type="' + (type || 'text') + '" data-arr="' + arr + '" data-i="' + i + '" data-f="' + f + '" value="' + esc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
  }
  function selCell(arr, i, f, v, opts) {
    return '<select data-arr="' + arr + '" data-i="' + i + '" data-f="' + f + '">' + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === (v || '') ? ' selected' : '') + '>' + esc(o || '(선택)') + '</option>'; }).join('') + '</select>';
  }
  function closureBanner(e, c) {
    if (e.status === '완료') return '<div class="ok-box">완료된 ECN 입니다.</div>';
    if (c.canClose) return '<div class="ok-box">종결 가능 — 필수정보와 조치가 모두 확인되었습니다. 「ECN 완료 처리」를 누를 수 있습니다.</div>';
    return '<div class="danger-box"><strong>완료 처리 제한</strong> · ' + esc(c.problems.join(' / ')) + '. 담당부서 확인 후 보완하세요.</div>';
  }
  function closureBox(c) {
    return '<div class="closure">' + [['적용 시점 · 재고 처리 방안', c.apply], ['변경자재 재고 처리 지정', c.materials], ['변경자재 담당부서', c.materialDept],
      ['영향도 검토 · 부서 조치', c.impacts], ['수평전개 검토', c.horizontal], ['판정', c.verdict]].map(function (x) {
      var ok = x[1] === '확인' || x[1] === '대상 없음' || x[1] === '변경자재 없음' || x[1] === '종결 가능';
      return '<div><div class="small muted">' + esc(x[0]) + '</div><strong class="' + (ok ? 'src-auto' : 'src-missing') + '">' + esc(x[1]) + '</strong></div>';
    }).join('') + '</div>';
  }

  function wire(main, e, isNew) {
    var db = App.db, today = App.today();
    function persist() {
      if (!isNew) App.save();
      var c = L.closureCheck(e);
      $('#closureBox', main).innerHTML = closureBox(c);
      $('#closureBanner', main).innerHTML = closureBanner(e, c);
      $('#typeCounts', main).textContent = L.typeCountText(e.materials);
      $('#stockUnd', main).textContent = L.stockUndecided(e.materials);
      $$('[data-delta]', main).forEach(function (s) { s.textContent = L.materialDelta(e.materials[+s.getAttribute('data-delta')]); });
      $$('[data-imp]', main).forEach(function (s) { s.innerHTML = App.statusBadge(L.impactStatus(e.impacts[+s.getAttribute('data-imp')], today)); });
    }
    var box = $('#ecnForm', main);
    box.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-k')) {
        var k = t.getAttribute('data-k');
        var v = t.value;
        if (k === 'revNo') v = L.toNum(v) == null ? 0 : L.toNum(v);
        e[k] = v;
        if (k === 'drawingBeforeId' || k === 'drawingAfterId') fillFromDrawing(e, L.findBy(db.drawings, v));
        if (k === 'drawingAfterId') { var da = L.findBy(db.drawings, v); if (da && !e.revAfter) e.revAfter = da.rev || ''; }
        persist();
        if (t.hasAttribute('data-re')) App.rerender();
      } else if (t.hasAttribute('data-ap')) {
        e.approval[t.getAttribute('data-ap')] = t.value; persist();
      } else if (t.hasAttribute('data-arr')) {
        var arr = e[t.getAttribute('data-arr')], i = +t.getAttribute('data-i'), f = t.getAttribute('data-f');
        arr[i][f] = (f === 'beforeQty' || f === 'afterQty') && t.value !== '' ? (L.toNum(t.value) == null ? t.value : L.toNum(t.value)) : t.value;
        persist();
      }
    });
    box.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.hasAttribute('data-delmat')) { e.materials.splice(+t.getAttribute('data-delmat'), 1); persist(); App.rerender(); }
      if (t.hasAttribute('data-delhz')) { e.horizontal.splice(+t.getAttribute('data-delhz'), 1); persist(); App.rerender(); }
    });
    $('#addMat', main).addEventListener('click', function () {
      e.materials.push({ type: '', location: '', beforeNo: '', beforeSpec: '', beforeQty: '', unit: 'EA', afterNo: '', afterSpec: '', afterQty: '', stock: '', dept: '', currentStock: '' });
      persist(); App.rerender();
    });
    $('#addHz', main).addEventListener('click', function () {
      e.horizontal.push({ drawingId: '', partNo: '', model: '', customer: '', relation: '', applies: '', result: '' });
      persist(); App.rerender();
    });
    $('#loadHz', main).addEventListener('click', function () {
      var cands = L.horizontalCandidates(db, e);
      var have = e.horizontal.map(function (h) { return L.norm(h.partNo); });
      var n = 0;
      cands.forEach(function (c) {
        if (have.indexOf(L.norm(c.partNo)) >= 0) return;
        e.horizontal.push({ drawingId: c.drawingId, partNo: c.partNo, model: c.model, customer: c.customer, relation: c.relation, applies: '검토 중', result: '' });
        n++;
      });
      persist(); App.toast(cands.length ? n + '건을 추가했습니다.' : '도면 연결이 없거나 대상이 없습니다. 먼저 변경 전·후 도면을 고르세요.'); App.rerender();
    });
    if (isNew) {
      $('#saveNew', main).addEventListener('click', function () {
        if (L.isBlank(e.ecnNo)) { App.toast('ECN 번호를 입력하세요.'); return; }
        if (db.ecns.some(function (x) { return L.norm(x.ecnNo) === L.norm(e.ecnNo); })) { App.toast('같은 ECN 번호가 이미 있습니다.'); return; }
        delete e._for;
        e.id = L.nextId(db.ecns, 'ECN-', 4);
        e.createdAt = L.toDateTimeStr(new Date());
        db.ecns.push(e);
        App.ui.ecnDraft = null;
        App.save(); App.toast(e.ecnNo + ' 을(를) 등록했습니다.'); App.go('#/ecn/' + e.id);
      });
      return;
    }
    var cb = $('#complete', main);
    if (cb) cb.addEventListener('click', function () {
      try { L.completeEcn(e, new Date()); App.save(); App.toast('ECN 을 완료 처리했습니다.'); App.rerender(); }
      catch (err) { App.dialog('완료 처리 제한', '<p>' + esc(err.message) + '</p><p class="small">원문 6.2·6.3: 적용일·재고처리·담당부서가 미정이거나 미완료 조치가 있으면 완료할 수 없습니다.</p>', [{ label: '확인', value: 'ok', primary: true }]); }
    });
    var ro = $('#reopen', main);
    if (ro) ro.addEventListener('click', function () { e.status = '진행 중'; e.completedAt = ''; App.save(); App.rerender(); });
    $('#delEcn', main).addEventListener('click', function () {
      if (!confirm(e.ecnNo + ' 을(를) 삭제할까요?')) return;
      db.ecns = db.ecns.filter(function (x) { return x !== e; }); App.save(); App.go('#/ecn');
    });
    $('#expReport', main).addEventListener('click', function () {
      var r = L.ecnReport(e, today);
      App.downloadXlsx('설계변경통보서_' + (e.ecnNo || e.id).replace(/[\\/:*?"<>|]/g, '_'), [
        { name: '설계변경통보서', rows: r.rows, merges: r.merges, widths: r.widths },
        { name: '6_변경자재목록', rows: L.sheetMaterials(db, e.id) }
      ]);
    });
  }

  // ── 변경자재 대장 (양식 6) ───────────────────
  App.view('materials', function (main, parts, q) {
    var db = App.db;
    var rows = [];
    db.ecns.forEach(function (e) {
      (e.materials || []).forEach(function (m) { if (m.type) rows.push({ e: e, m: m }); });
    });
    var f = { type: q.type || '', und: q.und === '1', text: q.text || '' };
    var list = rows.filter(function (r) {
      if (f.type && r.m.type !== f.type) return false;
      if (f.und && !(L.isBlank(r.m.stock) || r.m.stock === '미정')) return false;
      if (f.text) {
        var all = [r.e.ecnNo, r.m.beforeNo, r.m.afterNo, r.m.beforeSpec, r.m.afterSpec, r.m.dept, r.m.location].join(' ');
        if (L.norm(all).indexOf(L.norm(f.text)) < 0) return false;
      }
      return true;
    });
    var h = '<div class="page-head"><h1>변경자재</h1><div class="actions"><button type="button" class="btn" id="exp6">6 변경자재 목록 (엑셀)</button></div></div>' +
      '<form class="card form-grid" id="matFilter"><label class="field"><span>변경 유형</span><select name="type"><option value="">전체</option>' +
      L.CHANGE_TYPES.map(function (t) { return '<option' + (t === f.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>검색어</span><input type="text" name="text" value="' + esc(f.text) + '" placeholder="자재품번 · ECN 번호 · 부서"></label>' +
      '<label style="display:flex;gap:8px;align-items:center;align-self:end"><input type="checkbox" name="und"' + (f.und ? ' checked' : '') + '> 재고처리 미정만</label>' +
      '<div style="align-self:end"><button class="btn" type="submit">조회</button></div></form>' +
      App.table([
        { label: 'ECN', render: function (r) { return '<a href="#/ecn/' + r.e.id + '">' + esc(r.e.ecnNo) + '</a>'; } },
        { label: '변경 유형', render: function (r) { return esc(r.m.type); } },
        { label: '적용 위치', render: function (r) { return esc(r.m.location); } },
        { label: '변경 전', render: function (r) { return esc([r.m.beforeNo, r.m.beforeSpec, r.m.beforeQty !== '' && r.m.beforeQty != null ? r.m.beforeQty + ' ' + (r.m.unit || '') : ''].filter(Boolean).join(' · ')); } },
        { label: '변경 후', render: function (r) { return esc([r.m.afterNo, r.m.afterSpec, r.m.afterQty !== '' && r.m.afterQty != null ? r.m.afterQty + ' ' + (r.m.unit || '') : ''].filter(Boolean).join(' · ')); } },
        { label: '증감', render: function (r) { return esc(L.materialDelta(r.m)); }, cls: 'num' },
        { label: '재고 처리', render: function (r) { return L.isBlank(r.m.stock) || r.m.stock === '미정' ? App.statusBadge('미정') : esc(r.m.stock); } },
        { label: '담당 부서', render: function (r) { return esc(r.m.dept); } },
        { label: 'ECN 적용일', render: function (r) { return esc(r.e.applyDate || '미정'); } }
      ], list, { empty: '조건에 맞는 변경자재가 없습니다.' });
    main.innerHTML = h;
    $('#matFilter', main).addEventListener('submit', function (ev) {
      ev.preventDefault();
      App.go('#/materials?type=' + encodeURIComponent(this.type.value) + '&text=' + encodeURIComponent(this.text.value.trim()) + '&und=' + (this.und.checked ? '1' : ''));
    });
    $('#exp6', main).addEventListener('click', function () {
      App.downloadXlsx('6_변경자재목록', [{ name: '6_변경자재목록', rows: L.sheetMaterials(db) }]);
    });
  });
})(window);
