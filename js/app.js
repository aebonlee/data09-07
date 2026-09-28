/* 화면 공통 — 상태·저장·라우터·도우미. 화면별 코드는 view-*.js 에 있습니다. */
(function (root) {
  'use strict';
  var L = root.HNLogic;
  var views = {};
  var App = {
    L: L,
    db: null,
    files: {},     // 도면 ID → PDF 원본(ArrayBuffer). 저장소에는 넣지 않고 이 창에서만 씁니다.
    ui: {}         // 화면 사이에서 잠시 들고 있는 선택값
  };

  // ── 저장 ───────────────────────────────
  App.save = function () {
    if (!root.HNStore.saveDb(App.db)) {
      document.getElementById('storeWarn').hidden = false;
    }
    document.getElementById('sampleBanner').hidden = !App.db._sample;
    renderWho();
  };
  function renderWho() {
    var n = App.db.settings.approver;
    document.getElementById('whoami').textContent = n ? '확정자 · ' + n : '확정자 미설정';
  }

  // ── 도우미 ─────────────────────────────
  App.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  App.$ = function (sel, el) { return (el || document).querySelector(sel); };
  App.$$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  App.toast = function (msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(App._tt);
    App._tt = setTimeout(function () { t.hidden = true; }, 3200);
  };
  // 대화상자: buttons = [{label, value, primary}] → Promise(value)
  App.dialog = function (title, html, buttons) {
    var d = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    document.getElementById('dialogContent').innerHTML = html;
    var acts = document.getElementById('dialogActions');
    acts.innerHTML = '';
    (buttons || [{ label: '닫기', value: 'close' }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' btn-primary' : '');
      btn.value = b.value; btn.textContent = b.label;
      acts.appendChild(btn);
    });
    return new Promise(function (resolve) {
      d.onclose = function () { resolve(d.returnValue); };
      d.returnValue = '';
      d.showModal();
    });
  };
  App.statusBadge = function (s) {
    var cls = { '그룹 확정': 'b-ok', '검토대기': 'b-info', '추출 보정 필요': 'b-danger', '미분류': 'b-muted', '진행 중': 'b-info', '완료': 'b-ok',
      '지연': 'b-danger', '일정 미정': 'b-warn', '미검토': 'b-warn', '-': 'b-muted', '적중': 'b-ok', '미적중': 'b-danger', '종결 가능': 'b-ok', '종결 불가': 'b-danger' }[s] || 'b-muted';
    return '<span class="badge ' + cls + '">' + App.esc(s) + '</span>';
  };
  App.drawingLabel = function (d) { return d ? d.partNo + (d.rev ? ' · REV ' + d.rev : '') : ''; };
  App.today = function () { return new Date(); };

  // 표 그리기: cols = [{key|render, label, cls}], rows = objects
  App.table = function (cols, rows, opt) {
    opt = opt || {};
    var h = '<div class="table-wrap"><table class="tbl"' + (opt.id ? ' id="' + opt.id + '"' : '') + '><thead><tr>';
    cols.forEach(function (c) { h += '<th' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + App.esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + cols.length + '" class="muted">' + App.esc(opt.empty || '자료가 없습니다.') + '</td></tr>';
    rows.forEach(function (r) {
      h += '<tr' + (opt.rowAttr ? ' ' + opt.rowAttr(r) : '') + '>';
      cols.forEach(function (c) {
        var v = c.render ? c.render(r) : App.esc(r[c.key]);
        h += '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (v == null ? '' : v) + '</td>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  };

  // ── 엑셀 ───────────────────────────────
  App.xlsxReady = function () {
    if (!root.XLSX) { App.toast('엑셀 라이브러리를 불러오지 못했습니다. vendor/xlsx.full.min.js 를 확인하세요.'); return false; }
    return true;
  };
  // sheets = [{name, rows(2차원 배열), merges?, widths?}]
  App.downloadXlsx = function (fileName, sheets) {
    if (!App.xlsxReady()) return;
    var wb = root.XLSX.utils.book_new();
    sheets.forEach(function (s) {
      var ws = root.XLSX.utils.aoa_to_sheet(s.rows);
      if (s.merges) ws['!merges'] = s.merges.map(function (r) { return root.XLSX.utils.decode_range(r); });
      var widths = s.widths || autoWidths(s.rows);
      ws['!cols'] = widths.map(function (w) { return { wch: w }; });
      root.XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    });
    root.XLSX.writeFile(wb, App.fileName(fileName));
  };
  function autoWidths(rows) {
    var w = [];
    rows.slice(0, 200).forEach(function (r) {
      (r || []).forEach(function (v, i) {
        var len = String(v == null ? '' : v).split('\n')[0].length;
        var n = Math.min(50, Math.max(6, Math.ceil(len * 1.6)));
        w[i] = Math.max(w[i] || 6, n);
      });
    });
    return w;
  }
  // 예시 데이터 상태면 파일명에 「예시데이터」를 붙입니다
  App.fileName = function (base) {
    var d = L.toDateStr(new Date()).replace(/-/g, '');
    var name = base + '_' + d;
    if (App.db._sample) name = '예시데이터_' + name;
    return name + '.xlsx';
  };
  App.downloadText = function (fileName, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  // 엑셀·CSV 파일 → {sheetName: [ {머리행: 값} ]}
  App.readTable = function (file) {
    return file.arrayBuffer().then(function (buf) {
      var wb = root.XLSX.read(buf, { type: 'array', cellDates: true });
      var out = {};
      wb.SheetNames.forEach(function (n) {
        out[n] = root.XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: true });
      });
      return out;
    });
  };

  // ── 라우터 ─────────────────────────────
  App.view = function (name, fn) { views[name] = fn; };
  App.go = function (hash) { if (location.hash === hash) route(); else location.hash = hash; };
  App.rerender = function () { route(); };
  function route() {
    var h = location.hash.replace(/^#\/?/, '') || 'dashboard';
    var q = '';
    var qi = h.indexOf('?');
    if (qi >= 0) { q = h.slice(qi + 1); h = h.slice(0, qi); }
    var parts = h.split('/').map(decodeURIComponent);
    var name = parts[0];
    if (!views[name]) name = 'dashboard';
    App.$$('#sidebar a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-nav') === name || (name === 'drawing' && a.getAttribute('data-nav') === 'search')); });
    var main = document.getElementById('main');
    main.setAttribute('data-route', location.hash || '#/dashboard');
    var params = {};
    q.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    try {
      views[name](main, parts.slice(1), params);
    } catch (e) {
      main.innerHTML = '<div class="danger-box">화면을 그리는 중 오류가 났습니다: ' + App.esc(e.message) + '</div>';
      if (root.console) console.error(e);
    }
    var sb = document.getElementById('sidebar');
    sb.classList.remove('open');
    document.getElementById('menuBtn').setAttribute('aria-expanded', 'false');
  }

  App.loadSample = function () {
    var s = root.HNSample.build();
    s.settings = App.db.settings;
    App.db = L.normalizeDb(s);
    App.files = {};
    App.save();
  };

  App.start = function () {
    App.db = root.HNStore.loadDb();
    if (!root.HNStore.available()) document.getElementById('storeWarn').hidden = false;
    document.getElementById('sampleBanner').hidden = !App.db._sample;
    renderWho();
    if (root.pdfjsLib) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    document.getElementById('menuBtn').addEventListener('click', function () {
      var sb = document.getElementById('sidebar');
      var open = !sb.classList.contains('open');
      sb.classList.toggle('open', open);
      this.setAttribute('aria-expanded', String(open));
    });
    document.getElementById('globalSearch').addEventListener('submit', function (ev) {
      ev.preventDefault();
      App.go('#/search?text=' + encodeURIComponent(document.getElementById('globalQ').value.trim()));
    });
    root.addEventListener('hashchange', route);
    route();
  };

  root.HNApp = App;
})(window);
