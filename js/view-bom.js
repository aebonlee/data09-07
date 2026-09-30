/* BOM 구성 — 도면의 하우징 품번을 읽어 그 하우징에 딸린 ASSY 자재(LOCK·굵기별 단자 등)를 BOM 으로 펼칩니다.
   (2026-09-29 저녁 수강생 「문의03」 · 2026-09-30 오전 답 1~3)
   하우징 → ASSY 자재 마스터는 회사 자료라 도구에 들어 있지 않습니다. 사용자가 엑셀·CSV 로 불러오면
   이 브라우저 저장소(localStorage, db.housingMaster · housingInfo · gaSq)에만 둡니다. 두 형식을 받습니다.
    ① 도구 양식(한 줄 = 하우징 하나에 딸린 자재 하나)
    ② 회사 자재 DB 내보내기(hsg_detail · hsg_pin_block · tml_detail … 시트) — 시트·열 이름으로 자동 맞춤
   계산은 logic.js 순수 함수입니다(parseHousingMaster · parseErpMaster · housingsFromCavTables · expandHousingBom).
   2026-09-30 오후 답: ① 도면 품번과 꼬리만 다른 DB 품번은 다른 품번으로 보고 선택창에서 고름 ③ 캡 · 옵션은 BOM 에, 짝 하우징은 참고 후 선택
   ⑤ 여러 장 도면은 CAV 표를 읽을 쪽을 고르되 「전체 페이지」(기본)도 됨. */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;

  // 체험용 가상 마스터 — 자재 품번은 모두 지어낸 값입니다(실제 자재 아님). 하우징 품번은 수강생 캡처의 표기.
  var SAMPLE_MASTER = [
    ['하우징 품번', '자재 품번', '자재명', '구분', '수량', '단위', '수량 기준', '적용 전선(SQ)', '핀 수', '적용 핀(CAV)', '비고'],
    ['DT06-2S-CE06', 'EX-LK-2S', 'LOCK (2극용)', 'LOCK', 1, 'EA', '하우징당', '', 2, '', '예시 — 실제 자재 아님'],
    ['', 'EX-TM-S16-A', '단자 (소켓 · 소)', '단자', 1, 'EA', '회로당', '0.5~1.0', '', '', '예시 — 실제 자재 아님'],
    ['', 'EX-TM-S16-B', '단자 (소켓 · 대)', '단자', 1, 'EA', '회로당', '1.25~2.0', '', '', '예시 — 실제 자재 아님'],
    ['', 'EX-SL-2S', '실(방수 씰)', '씰', 1, 'EA', '회로당', '', '', '', '예시 — 실제 자재 아님'],
    ['', 'EX-DM-2S', '더미 플러그', '더미', 1, 'EA', '빈 자리당', '', '', '', '예시 — 실제 자재 아님'],
    ['CN-0118', 'EX-LK-3P', 'LOCK (3극용)', 'LOCK', 1, 'EA', '하우징당', '', 3, '', '예시 — 실제 자재 아님'],
    ['', 'EX-TM-P20', '단자 (핀)', '단자', 1, 'EA', '회로당', '0.3~0.85', '', '', '예시 — 실제 자재 아님']
  ];

  function st() {
    if (!App.ui.bom) App.ui.bom = { drw: '', text: '', found: null, missing: [], merge: false, extra: '', page: 'all', picks: {}, match: {} };
    return App.ui.bom;
  }
  function master() { return App.db.housingMaster || (App.db.housingMaster = []); }
  function info() { return App.db.housingInfo || (App.db.housingInfo = {}); }
  function gaSq() { return App.db.gaSq || (App.db.gaSq = {}); }
  function bomOpt(merge) { return { merge: merge, info: info(), gaSq: gaSq() }; }

  App.view('bom', function (main, parts, q) {
    var s = st(), db = App.db, m = master();
    if (q.d && q.d !== s._q) { s._q = q.d; s.drw = q.d; s.found = null; s.page = 'all'; }
    var dsel = s.drw ? L.findBy(db.drawings, s.drw) : null, pages = dsel ? L.cavPages(dsel.cavTables) : [];
    var hs = Object.keys(uniqKeys(m));
    var ms = db.housingMasterStats;
    var h = '<div class="page-head"><h1>BOM 구성 — 하우징 ASSY 자재</h1></div>' +
      '<p class="principle">도면에 있는 하우징 품번(예: DT06-2S-CE06)을 찾아, 그 하우징에 맞는 LOCK · 전선 굵기별 단자 같은 ASSY 자재를 함께 불러와 BOM 을 만듭니다. ' +
      '단자·씰은 <strong>하우징에서 전선이 들어가는 자리(쓰는 회로)만</strong> 세고, 전선 굵기(SQ)에 맞는 단자를 자리마다 고릅니다. ' +
      '어떤 하우징에 어떤 자재가 딸리는지는 <strong>하우징 ASSY 마스터</strong>(회사 자재 DB 내보내기 엑셀, 또는 도구 양식)를 불러와서 씁니다.</p>';

    // 1 마스터
    h += '<div class="card"><h2>1 하우징 ASSY 마스터</h2>' +
      '<p class="small">지금 ' + (m.length ? '<strong>하우징 ' + hs.length + '종 · 자재 ' + m.length + '행</strong>이 들어 있습니다' + (db.housingMasterName ? ' (' + esc(db.housingMasterName) + ')' : '') + '.' : '마스터가 비어 있습니다. 회사 자재 DB 엑셀이나 도구 양식을 불러오거나 「예시 마스터 넣기」로 체험해 보세요.') + '</p>' +
      (ms ? statsBox(ms) : '') +
      '<div class="actions"><label class="btn btn-primary" for="hmFile">엑셀 · CSV 불러오기</label><input id="hmFile" type="file" accept=".xlsx,.xls,.csv" class="sr">' +
      '<button type="button" class="btn" id="hmTemplate">빈 양식 내려받기</button>' +
      '<button type="button" class="btn" id="hmSample">예시 마스터 넣기</button>' +
      '<button type="button" class="btn" id="hmExport"' + (m.length ? '' : ' disabled') + '>지금 마스터 (엑셀)</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="hmClear"' + (m.length ? '' : ' disabled') + '>마스터 비우기</button></div>' +
      '<details class="small" style="margin-top:8px"><summary>불러올 수 있는 형식</summary>' +
      '<p><strong>회사 자재 DB 내보내기</strong> — 시트 <code>hsg_detail</code> 이 있으면 이 형식으로 봅니다. 시트·열 이름으로 자동으로 맞춥니다: ' +
      'hsg_detail(하우징 · 핀 수 · LOCK) → hsg_pin_block(핀 범위별 단자 · 씰 · 더미, 없으면 hsg_pin) · hsg_cover(커버) · hsg_etc_add_link_detail(부가 자재) · ' +
      'tml_detail · seal_detail(단자·씰이 맞는 전선 굵기 SQ 범위) · ga_sq_conversion(GA → SQ) · Item(품명). 회사(company)가 여럿이면 고르게 합니다. ' +
      '캡 · 옵션 품번은 BOM 에 넣고, 짝 하우징은 참고로 보여 준 뒤 「찾은 하우징」 표에서 고른 것만 넣습니다.</p>' +
      '<p><strong>도구 양식</strong> — 한 줄 = 하우징 하나에 딸린 자재 하나. 하우징 칸이 비어 있으면 윗줄 하우징으로 봅니다(병합 셀 그대로 붙여도 됨).</p><ul>' +
      '<li>꼭 있어야 하는 열: <strong>하우징 품번</strong>, <strong>자재 품번</strong>. 있으면 쓰는 열: 자재명, 구분(LOCK·단자·씰·더미), 수량, 단위, 수량 기준(하우징당 / 회로당 / 빈 자리당), 적용 전선(SQ — 예: 0.5~1.0), 핀 수, 적용 핀(CAV — 예: 1~3, 5), 비고.</li>' +
      '<li>수량 기준을 비워 두면 「단자·씰」은 회로당, 「더미」는 빈 자리당, 나머지는 하우징당으로 봅니다.</li>' +
      '<li>같은 구분의 단자가 적용 전선 범위로 나뉘어 있으면 회로마다 그 전선 굵기가 들어가는 단자 하나를 고릅니다. 굵기를 모르면 후보를 모두 넣고 「전선 굵기 입력 필요」로 표시합니다.</li></ul>' +
      '<p class="muted">마스터는 이 브라우저에만 저장됩니다(서버로 보내지 않음). 「설정 → 백업 내려받기」에 함께 들어갑니다.</p></details>' +
      (m.length ? '<details style="margin-top:6px"><summary class="small">마스터 내용 보기 (앞 200행 / ' + m.length + '행)</summary>' + App.table([
        { label: '하우징 품번', key: 'housing' }, { label: '자재 품번', key: 'item' }, { label: '자재명', key: 'name' }, { label: '구분', key: 'kind' },
        { label: '수량', key: 'qty', cls: 'num' }, { label: '수량 기준', key: 'basis' }, { label: '적용 전선(SQ)', key: 'csaText' },
        { label: '적용 핀', render: function (r) { return esc(r.pinRange || '전체'); } }, { label: '비고', key: 'note' }
      ], m.slice(0, 200)) + '</details>' : '') + '</div>';

    // 2 도면 고르기
    h += '<div class="card"><h2>2 도면 고르기 · 하우징 찾기</h2><div class="form-grid">' +
      '<label class="field"><span>등록한 도면</span><select id="bomDrw"><option value="">— 고르기 —</option>' + db.drawings.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === s.drw ? ' selected' : '') + '>' + esc(App.drawingLabel(x)) + '</option>';
      }).join('') + '</select></label>' +
      (pages.length > 1 ? '<label class="field"><span>CAV 표를 읽을 쪽 (이 도면 ' + (dsel.pages || pages[pages.length - 1]) + '장)</span><select id="bomPage">' +
        '<option value="all"' + (s.page === 'all' ? ' selected' : '') + '>전체 페이지 — ' + pages.length + '개 쪽의 CAV 표를 함께</option>' +
        pages.map(function (p) { return '<option value="' + p + '"' + (String(s.page) === String(p) ? ' selected' : '') + '>' + p + '쪽만</option>'; }).join('') + '</select></label>' : '') +
      '<label class="field wide"><span>하우징 품번 직접 넣기 (글자 정보가 없는 PDF 일 때 — 쉼표로 구분, 같은 품번을 여러 번 쓰면 개수)</span><input type="text" id="bomExtra" value="' + esc(s.extra) + '" placeholder="예: DT06-2S-CE06, DT06-2S-CE06, CN-0118"></label></div>' +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary" id="bomFind"' + (m.length ? '' : ' disabled') + '>하우징 찾기</button>' +
      (m.length ? '' : '<span class="small muted">마스터를 먼저 넣어 주세요.</span>') + '</div>' +
      '<p class="small muted">① 도면의 <strong>CAV 표</strong>(CAV · WIRE · CSA, PIN · CORE · GA — 글자 정보가 있는 PDF 를 등록할 때 읽어 둔 것)에서 커넥터마다 하우징 품번 · 쓰는 핀 · 전선 굵기를 가져오고, ' +
      '② 그 밖에 도면 글자 · 「주요 커넥터」 칸에서 마스터에 있는 하우징 품번을 찾아 개수를 셉니다. 글자를 선으로 그린 PDF 는 읽을 글자가 없으니 위 칸에 직접 넣고, 아래 표에 「사용 핀:굵기」를 넣어 주세요.</p>' +
      '<div id="foundBox"></div></div>';

    // 3 결과
    h += '<div class="card"><div class="page-head"><h2 style="margin:0">3 BOM</h2><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="bomMerge"' + (s.merge ? ' checked' : '') + '> 같은 자재 합치기</label></div>' +
      '<div id="bomOut"><p class="muted small">하우징을 찾으면 여기에 BOM 이 나옵니다.</p></div></div>';
    main.innerHTML = h;
    wire(main, s);
    if (s.found) renderFound(s);
  });

  function uniqKeys(m) {
    var o = {};
    m.forEach(function (r) { o[r.housing] = 1; });
    Object.keys(info()).forEach(function (k) { o[k] = 1; });
    return o;
  }
  function statsBox(x) {
    var k = x.byKind || {};
    return '<div class="ok-box small">회사 자재 DB 에서 읽음 — hsg_detail ' + x.details + '행 중 회사 「' + esc(x.company) + '」 하우징 <strong>' + x.housings + '종</strong>' +
      (x.otherCompany ? ' (다른 회사 ' + x.otherCompany + '행은 뺌)' : '') + ' → 자재 <strong>' + x.rows + '행</strong>: ' +
      esc(Object.keys(k).map(function (n) { return n + ' ' + k[n]; }).join(' · ')) + '. 단자 ' + x.terminals + '행 중 전선 굵기 범위(SQ)를 찾은 것 ' + x.terminalsWithSq + '행, 씰 ' + x.seals + '행 중 ' + x.sealsWithSq + '행' +
      (x.gaSq ? ' · GA/SQ 환산 ' + x.gaSq + '줄' : '') + '. 딸린 자재가 하나도 없는 하우징 ' + x.noChildren + '종.</div>';
  }

  function wire(main, s) {
    $('#hmFile', main).addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f || !App.xlsxReady()) return;
      f.arrayBuffer().then(function (buf) {
        var wb = root.XLSX.read(buf, { type: 'array' });
        if (L.isErpMasterBook(wb.SheetNames)) return importErp(wb, f.name, s);
        var best = null;
        wb.SheetNames.forEach(function (n) {
          var p = L.parseHousingMaster(root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }));
          if (p.rows.length && (!best || p.rows.length > best.p.rows.length)) best = { n: n, p: p };
        });
        if (!best) { App.toast('마스터 행을 찾지 못했습니다 — 회사 자재 DB(hsg_detail 시트)이거나 「하우징 품번」·「자재 품번」 열이 있는 표인지 확인해 주세요.'); return; }
        var cur = master();
        var go = function (mode) {
          if (mode === 'cancel' || !mode) return;
          App.db.housingMaster = mode === 'add' ? cur.concat(best.p.rows) : best.p.rows;
          if (mode !== 'add') { App.db.housingInfo = {}; App.db.gaSq = {}; App.db.housingMasterStats = null; }
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
      App.db.housingInfo = {}; App.db.gaSq = {}; App.db.housingMasterStats = null;
      App.save(); s.found = null; App.toast('예시 마스터를 넣었습니다. 자재 품번은 모두 가상 값입니다.'); App.rerender();
    });
    $('#hmExport', main).addEventListener('click', function () {
      var rows = [SAMPLE_MASTER[0]];
      master().forEach(function (r) { rows.push([r.housing, r.item, r.name, r.kind, r.qty, r.unit, r.basis, r.csaText, r.pins == null ? '' : r.pins, r.pinRange || '', r.note]); });
      App.downloadXlsx('하우징_ASSY_마스터', [{ name: '마스터', rows: rows }]);
    });
    $('#hmClear', main).addEventListener('click', function () {
      if (!confirm('마스터를 비울까요? (백업을 먼저 받아 두면 되돌릴 수 있습니다)')) return;
      App.db.housingMaster = []; App.db.housingMasterName = ''; App.db.housingInfo = {}; App.db.gaSq = {}; App.db.housingMasterStats = null;
      App.save(); s.found = null; App.rerender();
    });
    $('#bomDrw', main).addEventListener('change', function () { s.drw = this.value; s.found = null; s.page = 'all'; App.rerender(); });
    var bp = $('#bomPage', main);
    if (bp) bp.addEventListener('change', function () { s.page = this.value === 'all' ? 'all' : +this.value; if (s.found) find(s); });
    $('#bomExtra', main).addEventListener('change', function () { s.extra = this.value; });
    $('#bomFind', main).addEventListener('click', function () { s.extra = $('#bomExtra', main).value; find(s); });
    $('#bomMerge', main).addEventListener('change', function () { s.merge = this.checked; renderBom(s); });
  }

  // 회사 자재 DB 내보내기(여러 시트) — 필요한 시트만 읽습니다
  function importErp(wb, fileName, s) {
    var book = {};
    wb.SheetNames.forEach(function (n) {
      if (L.ERP_SHEETS.indexOf(n.trim().toLowerCase()) >= 0) book[n] = root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false });
    });
    var comps = L.erpCompanies(book), names = Object.keys(comps);
    var pick = names.length > 1 ? App.dialog('회사 자재 DB — 회사 고르기', '<p>' + esc(fileName) + ' 의 하우징(hsg_detail)이 회사별로 나뉘어 있습니다. BOM 에 쓸 회사를 골라 주세요.</p><ul>' +
      names.map(function (n) { return '<li>' + esc(n || '(빈 칸)') + ' — 하우징 ' + comps[n] + '행</li>'; }).join('') + '</ul>',
      [{ label: '취소', value: '__cancel' }].concat(names.map(function (n, i) { return { label: n || '(빈 칸)', value: n, primary: i === 0 }; }))) : Promise.resolve(names[0] || '');
    return pick.then(function (company) {
      if (company === '__cancel' || company == null) return;
      var p = L.parseErpMaster(book, { company: company });
      if (p.error) { App.toast(p.error); return; }
      var apply = function () {
        App.db.housingMaster = p.rows; App.db.housingInfo = p.info; App.db.gaSq = p.gaSq;
        App.db.housingMasterStats = p.stats; App.db.housingMasterName = fileName + ' · 회사 자재 DB (' + company + ')';
        App.save(); s.found = null;
        App.toast('회사 자재 DB 에서 하우징 ' + p.stats.housings + '종 · 자재 ' + p.rows.length + '행을 넣었습니다.'); App.rerender();
      };
      if (!master().length) apply();
      else App.dialog('마스터 바꾸기', '<p>지금 마스터(' + master().length + '행)를 회사 자재 DB 에서 읽은 ' + p.rows.length + '행으로 바꿀까요?</p>',
        [{ label: '취소', value: 'cancel' }, { label: '바꾸기', value: 'ok', primary: true }]).then(function (v) { if (v === 'ok') apply(); });
    });
  }

  // 비슷한 품번 선택 결과: 도면이 있으면 도면에(d.bomPicks), 없으면 이 화면 상태에 둡니다
  function picksOf(s, d) { return d ? (d.bomPicks || (d.bomPicks = {})) : s.picks; }
  function matchOf(s, d) { return d ? (d.bomMatch || (d.bomMatch = {})) : s.match; }
  function find(s, noAsk) {
    var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null, m = master(), inf = info(), picks = picksOf(s, d);
    var found = [], need = [], keys = Object.keys(uniqKeys(m)), has = {};
    keys.forEach(function (k) { has[k] = 1; });
    s.missing = [];
    // ① CAV 표에서 읽은 커넥터(하우징 · 쓰는 핀 · 굵기) — 가장 정확. 쪽을 골랐으면 그 쪽만, 기본은 전체 페이지
    if (d && d.cavTables && d.cavTables.length) {
      var hc = L.housingsFromCavTables(d.cavTables, m, inf, { picks: picks, page: s.page });
      found = hc.found; s.missing = hc.missing; need = hc.needPick.slice();
    }
    // ② 도면 글자 · 주요 커넥터 칸
    (d ? L.findHousings(d.rawText || '', d.connectors || '', m, inf) : []).forEach(function (x) {
      if (!found.some(function (y) { return y.housing === x.housing; })) found.push(x);
    });
    // 직접 넣은 품번: 같은 품번을 여러 번 쓰면 개수로 셉니다(도면에서 찾은 것보다 우선)
    // 마스터에 없는 품번은 CAV 표와 같이 비슷한 품번 선택창을 거칩니다(고른 품번으로 바꿔 넣음)
    var extra = {};
    L.splitList(s.extra).forEach(function (x) { x = L.norm(x); extra[x] = (extra[x] || 0) + 1; });
    Object.keys(extra).forEach(function (k0) {
      var k = k0, drawn = '';
      if (!has[k0]) {
        var pk = Object.prototype.hasOwnProperty.call(picks, k0) ? L.norm(picks[k0]) : null, near = L.nearHousings(k0, keys);
        if (pk && has[pk]) { k = pk; drawn = k0; }
        else if (near.length && pk == null) { need.push({ name: '직접 입력', housing: k0, near: near }); return; }
        else if (near.length) { s.missing.push({ name: '직접 입력', housing: k0, near: near, skipped: true }); return; }
      }
      var f = found.filter(function (x) { return x.housing === k; })[0];
      if (f) { f.count = extra[k0]; f.from = '직접 입력'; delete f.instances; } else found.push(f = { housing: k, count: extra[k0], from: '직접 입력' });
      if (drawn) f.drawn = [drawn];
    });
    // 도면에 저장해 둔 회로 수·전선 굵기·사용 핀이 있으면 이어 씁니다(CAV 표로 찾은 것은 표 값 그대로)
    var saved = d && d.bomInputs ? d.bomInputs : {};
    found.forEach(function (f) {
      if (f.instances) return;
      var sv = saved[f.housing] || {};
      f.circuits = sv.circuits != null ? sv.circuits : L.housingPins(f.housing, m, inf);
      f.csa = sv.csa != null ? sv.csa : '';
      f.cavSpec = sv.cavSpec || '';
      if (sv.count != null && f.from !== '직접 입력') f.count = sv.count;
    });
    var mt = matchOf(s, d);
    found.forEach(function (f) { f.matchPick = mt[f.housing] || ''; });
    s.found = found;
    // 비슷한 품번만 있는 것 → 선택창(자동으로 같은 하우징으로 보지 않음)
    var seen = {};
    need = need.filter(function (x) { if (seen[x.housing]) return false; seen[x.housing] = 1; return true; });
    if (need.length && !noAsk) {
      renderFound(s);
      askPicks(need).then(function (res) {
        if (!res) return;
        Object.keys(res).forEach(function (h) { picks[h] = res[h]; });
        if (d) App.save();
        find(s, true);
      });
      return;
    }
    if (!found.length) App.toast(d ? '이 도면에서 마스터에 있는 하우징을 찾지 못했습니다. 직접 넣어 주세요.' : '도면을 고르거나 하우징 품번을 직접 넣어 주세요.');
    renderFound(s);
  }

  // 선택창: 도면(또는 직접 넣은) 품번과 꼬리만 다른 DB 품번 후보를 보여 주고 하나를 고르게 합니다
  function askPicks(need) {
    var html = '<p>도면에 적힌 품번이 자재 DB 에 그대로 없습니다. 꼬리(예: <code>-5</code>)만 다른 품번은 <strong>서로 다른 품번</strong>으로 보고 자동으로 합치지 않습니다. 쓸 품번을 골라 주세요.</p>' +
      need.map(function (x, i) {
        return '<fieldset class="pick-set"><legend><strong>' + esc(x.housing || '(품번 못 읽음)') + '</strong>' + (x.name ? ' <span class="small muted">' + esc(x.name) + (x.page ? ' · ' + x.page + '쪽' : '') + '</span>' : '') + '</legend>' +
          x.near.map(function (k, j) {
            var r = refText(k);
            return '<label class="pick-row"><input type="radio" name="pk' + i + '" value="' + esc(k) + '"' + (j === 0 ? ' checked' : '') + '> ' + esc(k) + (r ? ' <span class="small muted">' + esc(r) + '</span>' : '') + '</label>';
          }).join('') +
          '<label class="pick-row"><input type="radio" name="pk' + i + '" value=""> 고르지 않음 — BOM 에서 뺌</label></fieldset>';
      }).join('') + '<p class="small muted">고른 값은 이 도면에 저장되어 다음에는 묻지 않습니다. 「품번 다시 고르기」로 바꿀 수 있습니다.</p>';
    return App.dialog('비슷한 품번 고르기 (' + need.length + '건)', html, [{ label: '나중에', value: 'later' }, { label: '고른 대로 적용', value: 'ok', primary: true }]).then(function (v) {
      if (v !== 'ok') return null;
      var box = document.getElementById('dialogContent'), out = {};
      need.forEach(function (x, i) { var c = box.querySelector('input[name="pk' + i + '"]:checked'); out[x.housing] = c ? c.value : ''; });
      return out;
    });
  }
  function instText(f) {
    var gs = gaSq();
    return f.instances.map(function (i) {
      var used = i.cavs.filter(function (c) { return c.used; }), tally = {};
      used.forEach(function (c) { var v = L.gaugeValue(c.gauge, i.gaugeHead, gs), k = v && v.sq != null ? String(Math.round(v.sq * 1000) / 1000) : '?'; tally[k] = (tally[k] || 0) + 1; });
      return (i.name || '커넥터') + ' — 핀 ' + used.map(function (c) { return c.cav; }).join(',') + ' (SQ ' + Object.keys(tally).map(function (k) { return k + '×' + tally[k]; }).join(', ') + ')';
    }).join(' / ');
  }
  function refText(h) {
    var x = info()[h];
    if (!x) return '';
    return [x.pins ? '핀 ' + x.pins : '', x.match ? '짝 ' + x.match : '', x.cap ? '캡 ' + x.cap : '', x.opt ? '옵션 ' + x.opt : '', x.use === false ? '사용 안 함' : ''].filter(Boolean).join(' · ');
  }

  function renderFound(s) {
    var box = $('#foundBox'); if (!box) return;
    var f = s.found || [];
    box.innerHTML = '<h3 style="margin-top:12px">찾은 하우징 ' + f.length + '종</h3>' + App.table([
      { label: '하우징 품번', render: function (x) {
        var r = refText(x.housing), mo = L.matingOptions(x.housing, info());
        return '<strong>' + esc(x.housing) + '</strong>' + (x.drawn ? '<br><span class="small src-missing">도면 품번 ' + esc(x.drawn.join(', ')) + ' → 고른 품번</span>' : '') +
          (r ? '<br><span class="small muted">' + esc(r) + '</span>' : '') +
          (mo.length ? '<br><label class="small">짝 하우징 <select class="in-sm" style="width:auto" data-match="' + f.indexOf(x) + '"><option value="">BOM 에 넣지 않음 (참고만)</option>' +
            mo.map(function (k) { return '<option value="' + esc(k) + '"' + (L.norm(x.matchPick) === L.norm(k) ? ' selected' : '') + '>' + esc(k) + ' 넣기</option>'; }).join('') + '</select></label>' : '');
      } },
      { label: '찾은 곳', key: 'from' },
      { label: '도면 안 개수', render: function (x) {
        return x.instances ? esc(x.count) + '곳' : '<input type="number" min="0" class="in-sm" data-fi="' + f.indexOf(x) + '" data-fk="count" value="' + esc(x.count) + '">';
      } },
      { label: '쓰는 회로 · 전선 굵기', render: function (x) {
        if (x.instances) return '<span class="small">' + esc(instText(x)) + '</span>';
        var i = f.indexOf(x);
        return '<div class="small" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
          '<label>사용 핀:굵기 <input type="text" class="in-sm" style="width:14em" data-fi="' + i + '" data-fk="cavSpec" value="' + esc(x.cavSpec || '') + '" placeholder="예: 1:0.5, 2:18GA, 4:1.25"></label>' +
          '<span class="muted">비우면 →</span><label>회로 수 <input type="number" min="0" class="in-sm" data-fi="' + i + '" data-fk="circuits" value="' + esc(x.circuits) + '"></label>' +
          '<label>굵기 <input type="text" class="in-sm" data-fi="' + i + '" data-fk="csa" value="' + esc(x.csa) + '" placeholder="예: 0.5"></label></div>';
      } }
    ], f, { empty: '찾은 하우징이 없습니다.' }) +
      (s.missing && s.missing.length ? '<div class="warn-box small">마스터에 없는 하우징 ' + s.missing.length + '개(BOM 에 넣지 않음): ' + s.missing.map(function (x) {
        return esc((x.name ? x.name + ' ' : '') + (x.housing || '(품번 못 읽음)')) + (x.skipped ? ' — 「고르지 않음」으로 뺌' : x.near.length ? ' — 비슷한 품번 ' + esc(x.near.join(', ')) + ' (아직 고르지 않음)' : ' — 비슷한 품번 없음');
      }).join(' · ') + '. 품번이 다르게 적힌 것이면 「품번 다시 고르기」로 고르거나 위 「직접 넣기」 칸에 마스터의 품번으로 넣어 주세요.</div>' : '') +
      (hasPicks(s) || (s.missing || []).some(function (x) { return x.near && x.near.length; }) ? '<div class="actions"><button type="button" class="btn btn-sm" id="rePick">품번 다시 고르기</button></div>' : '') +
      '<p class="small muted">「사용 핀:굵기」는 전선이 들어가는 핀 번호와 그 전선 굵기(SQ 또는 GA)입니다 — 단자·씰은 이 핀 수만큼, 더미는 나머지 빈 자리만큼 셉니다. ' +
      '비워 두면 예전처럼 「회로 수 · 굵기 한 가지」로 셉니다(핀 번호는 1번부터로 봄). 도면을 고른 경우 고친 값은 그 도면에 저장됩니다.</p>';
    $$('[data-match]', box).forEach(function (sel) {
      sel.addEventListener('change', function () {
        var x = f[+sel.getAttribute('data-match')], d = s.drw ? L.findBy(App.db.drawings, s.drw) : null;
        x.matchPick = sel.value;
        var mt = matchOf(s, d);
        if (sel.value) mt[x.housing] = sel.value; else delete mt[x.housing];
        if (d) App.save();
        renderBom(s);
      });
    });
    var rp = $('#rePick', box);
    if (rp) rp.addEventListener('click', function () {
      var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null, p = picksOf(s, d);
      Object.keys(p).forEach(function (k) { delete p[k]; });
      if (d) App.save();
      find(s);
    });
    $$('[data-fi]', box).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var x = f[+inp.getAttribute('data-fi')], k = inp.getAttribute('data-fk');
        x[k] = k === 'csa' || k === 'cavSpec' ? inp.value.trim() : L.toNum(inp.value);
        var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null;
        if (d) {
          d.bomInputs = d.bomInputs || {};
          d.bomInputs[x.housing] = { count: x.count, circuits: x.circuits, csa: x.csa === '' ? null : x.csa, cavSpec: x.cavSpec || '' };
          App.save();
        }
        renderBom(s);
      });
    });
    renderBom(s);
  }

  function hasPicks(s) {
    var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null, p = d ? d.bomPicks || {} : s.picks;
    return Object.keys(p).length > 0;
  }
  function renderBom(s) {
    var box = $('#bomOut'); if (!box) return;
    if (!s.found || !s.found.length) { box.innerHTML = '<p class="muted small">하우징을 찾으면 여기에 BOM 이 나옵니다.</p>'; return; }
    var rows = L.expandHousingBom(s.found, master(), bomOpt(s.merge));
    var d = s.drw ? L.findBy(App.db.drawings, s.drw) : null;
    var nChk = rows.filter(function (r) { return r.확인; }).length;
    box.innerHTML = (nChk ? '<div class="warn-box small">확인이 필요한 행 ' + nChk + '건 — 「확인」 칸을 봐 주세요(전선 굵기 미입력, 굵기에 맞는 단자 없음, 선택 자재, 마스터에 없는 하우징, 도면과 다른 품번을 고른 하우징).</div>' : '') +
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
      '<p class="small muted">출처: 「CAV 표 · 도면 글자 · 주요 커넥터 칸 · 직접 입력」 = 도면에서 읽은 하우징, 「ASSY 마스터 (하우징)」 = 마스터에서 불러온 딸린 자재. ' +
      '캡 · 옵션은 하우징당 자재로 늘 넣고, 짝 하우징은 위 표에서 고른 것만 넣습니다. ' +
      '수량 = 하우징당 자재는 마스터 수량 × 개수, 단자·씰은 마스터 수량 × <strong>쓰는 회로 수</strong>(굵기별로 맞는 단자에), 더미는 × 빈 자리 수.</p>';
    var label = d ? App.drawingLabel(d) : '직접 입력';
    $('#bomX', box).addEventListener('click', function () {
      App.downloadXlsx('BOM구성_' + (d ? d.partNo || d.id : '직접입력'), [{ name: 'BOM', rows: L.sheetHousingBom(rows, label) }]);
    });
    $('#bomToCmp', box).addEventListener('click', function () {
      var t = { label: 'BOM 구성 — ' + label, headers: ['품목코드', '품목명', '단위', '수량', '적요'], partNo: d ? d.partNo : '',
        rows: L.expandHousingBom(s.found, master(), bomOpt(true)).map(function (r) { return { 품목코드: r.품목코드, 품목명: r.품목명, 단위: r.단위, 수량: r.수량, 적요: r.출처 }; }) };
      if (App.setCompareBom) { App.setCompareBom('B', t); App.go('#/compare'); App.toast('도면 비교 5절의 B 표로 넣었습니다. A 에 ERP BOM 을 넣고 「표 비교」를 눌러 보세요.'); }
    });
  }
})(window);
