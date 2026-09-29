/* BOM 구성 — 도면의 하우징 품번을 읽어 그 하우징에 딸린 ASSY 자재(LOCK·굵기별 단자 등)를 BOM 으로 펼칩니다.
   (2026-09-29 저녁 수강생 「문의03」)
   하우징 → ASSY 자재 마스터는 회사 자료라 도구에 들어 있지 않습니다. 사용자가 엑셀·CSV 로 불러오면
   이 브라우저 저장소(localStorage, db.housingMaster)에만 둡니다. 계산은 logic.js 순수 함수입니다
   (parseHousingMaster · findHousings · expandHousingBom). */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  // 체험용 가상 마스터 — 자재 품번은 모두 지어낸 값입니다(실제 자재 아님). 하우징 품번은 수강생 캡처의 표기.
  var SAMPLE_MASTER = [
    ['하우징 품번', '자재 품번', '자재명', '구분', '수량', '단위', '수량 기준', '적용 전선(SQ)', '핀 수', '비고'],
    ['DT06-2S-CE06', 'EX-LK-2S', 'LOCK (2극용)', 'LOCK', 1, 'EA', '하우징당', '', 2, '예시 — 실제 자재 아님'],
    ['', 'EX-TM-S16-A', '단자 (소켓 · 소)', '단자', 1, 'EA', '회로당', '0.5~1.0', '', '예시 — 실제 자재 아님'],
    ['', 'EX-TM-S16-B', '단자 (소켓 · 대)', '단자', 1, 'EA', '회로당', '1.25~2.0', '', '예시 — 실제 자재 아님'],
    ['', 'EX-SL-2S', '실(방수 씰)', '씰', 1, 'EA', '회로당', '', '', '예시 — 실제 자재 아님'],
    ['CN-0118', 'EX-LK-3P', 'LOCK (3극용)', 'LOCK', 1, 'EA', '하우징당', '', 3, '예시 — 실제 자재 아님'],
    ['', 'EX-TM-P20', '단자 (핀)', '단자', 1, 'EA', '회로당', '0.3~0.85', '', '예시 — 실제 자재 아님']
  ];

  function st() {
    if (!App.ui.bom) App.ui.bom = { drw: '', text: '', found: null, merge: false, extra: '' };
    return App.ui.bom;
  }
  function master() { return App.db.housingMaster || (App.db.housingMaster = []); }

  App.view('bom', function (main, parts, q) {
    var s = st(), db = App.db, m = master();
    if (q.d && q.d !== s._q) { s._q = q.d; s.drw = q.d; s.found = null; }
    var d = s.drw ? L.findBy(db.drawings, s.drw) : null;
    var hs = uniqHousings(m);
    var h = '<div class="page-head"><h1>BOM 구성 — 하우징 ASSY 자재</h1></div>' +
      '<p class="principle">도면에 있는 하우징 품번(예: DT06-2S-CE06)을 찾아, 그 하우징에 맞는 LOCK · 전선 굵기별 단자 같은 ASSY 자재를 함께 불러와 BOM 을 만듭니다. ' +
      '어떤 하우징에 어떤 자재가 딸리는지는 <strong>하우징 ASSY 마스터</strong> 표(엑셀·CSV)를 불러와서 씁니다.</p>';

    // 1 마스터
    h += '<div class="card"><h2>1 하우징 ASSY 마스터</h2>' +
      '<p class="small">지금 ' + (m.length ? '<strong>하우징 ' + hs.length + '종 · 자재 ' + m.length + '행</strong>이 들어 있습니다' + (db.housingMasterName ? ' (' + esc(db.housingMasterName) + ')' : '') + '.' : '마스터가 비어 있습니다. 엑셀·CSV 를 불러오거나 「예시 마스터 넣기」로 체험해 보세요.') + '</p>' +
      '<div class="actions"><label class="btn btn-primary" for="hmFile">엑셀 · CSV 불러오기</label><input id="hmFile" type="file" accept=".xlsx,.xls,.csv" class="sr">' +
      '<button type="button" class="btn" id="hmTemplate">빈 양식 내려받기</button>' +
      '<button type="button" class="btn" id="hmSample">예시 마스터 넣기</button>' +
      '<button type="button" class="btn" id="hmExport"' + (m.length ? '' : ' disabled') + '>지금 마스터 (엑셀)</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="hmClear"' + (m.length ? '' : ' disabled') + '>마스터 비우기</button></div>' +
      '<details class="small" style="margin-top:8px"><summary>마스터 양식 — 이렇게 만들어 주세요</summary>' +
      '<ul><li>한 줄 = 하우징 하나에 딸린 자재 하나. 하우징 칸이 비어 있으면 윗줄 하우징으로 봅니다(병합 셀 그대로 붙여도 됨).</li>' +
      '<li>꼭 있어야 하는 열: <strong>하우징 품번</strong>, <strong>자재 품번</strong>. 있으면 쓰는 열: 자재명, 구분(LOCK·단자·씰), 수량, 단위, 수량 기준(하우징당 / 회로당), 적용 전선(SQ — 예: 0.5~1.0), 핀 수, 비고.</li>' +
      '<li>수량 기준을 비워 두면 구분·자재명에 「단자·씰」이 들어간 행은 회로당, 나머지는 하우징당으로 봅니다.</li>' +
      '<li>적용 전선이 적힌 단자는 도면의 전선 굵기에 맞는 것만 넣습니다. 굵기를 모르면 모두 넣고 「전선 굵기 입력 필요」로 표시합니다.</li></ul>' +
      '<p class="muted">마스터는 이 브라우저에만 저장됩니다(서버로 보내지 않음). 「설정 → 백업 내려받기」에 함께 들어갑니다. 실제 회사 마스터의 열 구성이 다르면 알려 주세요 — 맞춰 고치겠습니다.</p></details>' +
      (m.length ? '<details style="margin-top:6px"><summary class="small">마스터 내용 보기 (' + m.length + '행)</summary>' + App.table([
        { label: '하우징 품번', key: 'housing' }, { label: '자재 품번', key: 'item' }, { label: '자재명', key: 'name' }, { label: '구분', key: 'kind' },
        { label: '수량', key: 'qty', cls: 'num' }, { label: '단위', key: 'unit' }, { label: '수량 기준', key: 'basis' }, { label: '적용 전선', key: 'csaText' }, { label: '비고', key: 'note' }
      ], m.slice(0, 200)) + '</details>' : '') + '</div>';

    // 2 도면 고르기
    h += '<div class="card"><h2>2 도면 고르기 · 하우징 찾기</h2><div class="form-grid">' +
      '<label class="field"><span>등록한 도면</span><select id="bomDrw"><option value="">— 고르기 —</option>' + db.drawings.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === s.drw ? ' selected' : '') + '>' + esc(App.drawingLabel(x)) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field wide"><span>하우징 품번 직접 넣기 (글자 정보가 없는 PDF 일 때 — 쉼표로 구분, 같은 품번을 여러 번 쓰면 개수)</span><input type="text" id="bomExtra" value="' + esc(s.extra) + '" placeholder="예: DT06-2S-CE06, DT06-2S-CE06, CN-0118"></label></div>' +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary" id="bomFind"' + (m.length ? '' : ' disabled') + '>하우징 찾기</button>' +
      (m.length ? '' : '<span class="small muted">마스터를 먼저 넣어 주세요.</span>') + '</div>' +
      '<p class="small muted">도면의 글자(PDF 안 글자)와 「주요 커넥터」 칸에서 마스터에 있는 하우징 품번을 찾아 개수를 셉니다. 글자를 선으로 그린 PDF 는 읽을 글자가 없으니 위 칸에 직접 넣어 주세요.</p>' +
      '<div id="foundBox"></div></div>';

    // 3 결과
    h += '<div class="card"><div class="page-head"><h2 style="margin:0">3 BOM</h2><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bomMerge"' + (s.merge ? ' checked' : '') + '> 같은 자재 합치기</label></div>' +
      '<div id="bomOut"><p class="muted small">하우징을 찾으면 여기에 BOM 이 나옵니다.</p></div></div>';
    main.innerHTML = h;
    wire(main, s, d);
    if (s.found) renderFound(s);
  });

  function uniqHousings(m) {
    var o = [];
    m.forEach(function (r) { if (o.indexOf(r.housing) < 0) o.push(r.housing); });
    return o;
  }

  function wire(main, s, d) {
    $('#hmFile', main).addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f || !App.xlsxReady()) return;
      f.arrayBuffer().then(function (buf) {
        var wb = root.XLSX.read(buf, { type: 'array' });
        var best = null;
        wb.SheetNames.forEach(function (n) {
          var p = L.parseHousingMaster(root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }));
          if (p.rows.length && (!best || p.rows.length > best.p.rows.length)) best = { n: n, p: p };
        });
        if (!best) { App.toast('마스터 행을 찾지 못했습니다 — 「하우징 품번」·「자재 품번」 열이 있는지 확인해 주세요.'); return; }
        var cur = master();
        var go = function (mode) {
          if (mode === 'cancel' || !mode) return;
          App.db.housingMaster = mode === 'add' ? cur.concat(best.p.rows) : best.p.rows;
          App.db.housingMasterName = f.name + ' · ' + best.n;
          App.save(); s.found = null;
          App.toast('마스터 ' + best.p.rows.length + '행을 ' + (mode === 'add' ? '더했습니다' : '넣었습니다') + '.'); App.rerender();
        };
        if (!cur.length) go('replace');
        else App.dialog('마스터 불러오기', '<p>' + esc(f.name) + ' 에서 ' + best.p.rows.length + '행을 읽었습니다. 지금 마스터(' + cur.length + '행)를 바꿀까요, 뒤에 더할까요?</p>',
          [{ label: '취소', value: 'cancel' }, { label: '뒤에 더하기', value: 'add' }, { label: '바꾸기', value: 'replace', primary: true }]).then(go);
      }).catch(function (e) { App.toast('파일을 읽지 못했습니다: ' + e.message); });
    });
    $('#hmTemplate', main).addEventListener('click', function () {
      App.downloadXlsx('하우징_ASSY_마스터_양식', [{ name: '마스터', rows: [SAMPLE_MASTER[0]] }, { name: '작성 예시(가상)', rows: SAMPLE_MASTER }]);
    });
    $('#hmSample', main).addEventListener('click', function () {
      App.db.housingMaster = L.parseHousingMaster(SAMPLE_MASTER).rows; App.db.housingMasterName = '예시 마스터(가상)';
      App.save(); s.found = null; App.toast('예시 마스터를 넣었습니다. 자재 품번은 모두 가상 값입니다.'); App.rerender();
    });
    $('#hmExport', main).addEventListener('click', function () {
      var rows = [SAMPLE_MASTER[0]];
      master().forEach(function (r) { rows.push([r.housing, r.item, r.name, r.kind, r.qty, r.unit, r.basis, r.csaText, r.pins == null ? '' : r.pins, r.note]); });
      App.downloadXlsx('하우징_ASSY_마스터', [{ name: '마스터', rows: rows }]);
    });
    $('#hmClear', main).addEventListener('click', function () {
      if (!confirm('마스터를 비울까요? (백업을 먼저 받아 두면 되돌릴 수 있습니다)')) return;
      App.db.housingMaster = []; App.db.housingMasterName = ''; App.save(); s.found = null; App.rerender();
    });
    $('#bomDrw', main).addEventListener('change', function () { s.drw = this.value; s.found = null; App.rerender(); });
    $('#bomExtra', main).addEventListener('change', function () { s.extra = this.value; });
    $('#bomFind', main).addEventListener('click', function () { s.extra = $('#bomExtra', main).value; find(s); });
    $('#bomMerge', main).addEventListener('change', function () { s.merge = this.checked; renderBom(s); });
  }

  function find(s) {
    var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null, m = master();
    var found = d ? L.findHousings(d.rawText || '', d.connectors || '', m) : [];
    // 직접 넣은 품번: 같은 품번을 여러 번 쓰면 개수로 셉니다(도면에서 찾은 것보다 우선)
    var extra = {};
    L.splitList(s.extra).forEach(function (x) { extra[x] = (extra[x] || 0) + 1; });
    Object.keys(extra).forEach(function (k) {
      var f = found.filter(function (x) { return x.housing === k; })[0];
      if (f) { f.count = extra[k]; f.from = '직접 입력'; } else found.push({ housing: k, count: extra[k], from: '직접 입력' });
    });
    // 도면에 저장해 둔 회로 수·전선 굵기가 있으면 이어 씁니다
    var saved = d && d.bomInputs ? d.bomInputs : {};
    found.forEach(function (f) {
      var sv = saved[f.housing] || {};
      f.circuits = sv.circuits != null ? sv.circuits : L.housingPins(f.housing, m);
      f.csa = sv.csa != null ? sv.csa : '';
      if (sv.count != null && f.from !== '직접 입력') f.count = sv.count;
    });
    s.found = found;
    if (!found.length) App.toast(d ? '이 도면에서 마스터에 있는 하우징을 찾지 못했습니다. 직접 넣어 주세요.' : '도면을 고르거나 하우징 품번을 직접 넣어 주세요.');
    renderFound(s);
  }

  function renderFound(s) {
    var box = $('#foundBox'); if (!box) return;
    var f = s.found || [];
    box.innerHTML = '<h3 style="margin-top:12px">찾은 하우징 ' + f.length + '종</h3>' + App.table([
      { label: '하우징 품번', render: function (x) { return '<strong>' + esc(x.housing) + '</strong>'; } },
      { label: '찾은 곳', key: 'from' },
      { label: '도면 안 개수', render: function (x, i) { return '<input type="number" min="0" class="in-sm" data-fi="' + f.indexOf(x) + '" data-fk="count" value="' + esc(x.count) + '">'; } },
      { label: '사용 회로 수 (1개당)', render: function (x) { return '<input type="number" min="0" class="in-sm" data-fi="' + f.indexOf(x) + '" data-fk="circuits" value="' + esc(x.circuits) + '">'; } },
      { label: '전선 굵기 (SQ)', render: function (x) { return '<input type="text" class="in-sm" data-fi="' + f.indexOf(x) + '" data-fk="csa" value="' + esc(x.csa) + '" placeholder="예: 0.5">'; } }
    ], f, { empty: '찾은 하우징이 없습니다.' }) +
      '<p class="small muted">개수·회로 수·전선 굵기를 고치면 BOM 이 바로 바뀝니다. 회로 수 기본값은 마스터의 핀 수(없으면 품번의 「-2S」 같은 극수)입니다. 도면을 고른 경우 고친 값은 그 도면에 저장됩니다.</p>';
    $$('[data-fi]', box).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var x = f[+inp.getAttribute('data-fi')], k = inp.getAttribute('data-fk');
        x[k] = k === 'csa' ? inp.value.trim() : L.toNum(inp.value);
        var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null;
        if (d) {
          d.bomInputs = d.bomInputs || {};
          d.bomInputs[x.housing] = { count: x.count, circuits: x.circuits, csa: x.csa === '' ? null : x.csa };
          App.save();
        }
        renderBom(s);
      });
    });
    renderBom(s);
  }

  function renderBom(s) {
    var box = $('#bomOut'); if (!box) return;
    if (!s.found || !s.found.length) { box.innerHTML = '<p class="muted small">하우징을 찾으면 여기에 BOM 이 나옵니다.</p>'; return; }
    var rows = L.expandHousingBom(s.found, master(), { merge: s.merge });
    var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null;
    var nChk = rows.filter(function (r) { return r.확인; }).length;
    box.innerHTML = (nChk ? '<div class="warn-box small">확인이 필요한 행 ' + nChk + '건 — 「확인」 칸을 봐 주세요(전선 굵기 미입력, 마스터에 없는 하우징).</div>' : '') +
      App.table([
        { label: '품목코드', render: function (r) { return r.구분 === '하우징' ? '<strong>' + esc(r.품목코드) + '</strong>' : esc(r.품목코드); } },
        { label: '품목명', key: '품목명' }, { label: '구분', key: '구분' },
        { label: '수량', key: '수량', cls: 'num' }, { label: '단위', key: '단위' },
        { label: '출처', render: function (r) { return '<span class="badge ' + (/마스터/.test(r.출처) ? 'b-info' : 'b-muted') + '">' + esc(r.출처) + '</span>'; } },
        { label: '근거', key: '근거' },
        { label: '확인', render: function (r) { return r.확인 ? '<span class="src-missing">' + esc(r.확인) + '</span>' : ''; } }
      ], rows) +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn" id="bomX">BOM (엑셀)</button>' +
      '<button type="button" class="btn" id="bomToCmp">도면 비교 「5 부품 표 비교」의 B 로 보내기</button></div>' +
      '<p class="small muted">출처: 「도면 글자·주요 커넥터 칸·직접 입력」 = 도면에서 읽은 하우징, 「ASSY 마스터 (하우징)」 = 마스터에서 불러온 딸린 자재. 수량 = 마스터 수량 × (회로당이면 회로 수) × 도면 안 개수.</p>';
    var label = d ? App.drawingLabel(d) : '직접 입력';
    $('#bomX', box).addEventListener('click', function () {
      App.downloadXlsx('BOM구성_' + (d ? d.partNo || d.id : '직접입력'), [{ name: 'BOM', rows: L.sheetHousingBom(rows, label) }]);
    });
    $('#bomToCmp', box).addEventListener('click', function () {
      var t = { label: 'BOM 구성 — ' + label, headers: ['품목코드', '품목명', '단위', '수량', '적요'], partNo: d ? d.partNo : '',
        rows: L.expandHousingBom(s.found, master(), { merge: true }).map(function (r) { return { 품목코드: r.품목코드, 품목명: r.품목명, 단위: r.단위, 수량: r.수량, 적요: r.출처 }; }) };
      if (App.setCompareBom) { App.setCompareBom('B', t); App.go('#/compare'); App.toast('도면 비교 5절의 B 표로 넣었습니다. A 에 ERP BOM 을 넣고 「표 비교」를 눌러 보세요.'); }
    });
  }
})(window);
