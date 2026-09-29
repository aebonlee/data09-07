/* 도면 비교 — A품번(기준)과 B품번(비교 대상) 도면을 겹쳐 B의 차이를 적색으로 표시 (2026-09-29 수강생 추가 요청)
   2차(2026-09-29 오후): 실제 CAD PDF 두 쌍 기준으로 조정 — PDF 고해상도 렌더, 도곽 자동 정렬 + 미세 이동 보정,
   PDF 글자 비교(치수 350 → 450 같은 글자 변경), 실제 BOM 양식(ERP 정전개 조회) 읽기, ECN 양식 9절에 그림 넣은 엑셀.
   도면 그림은 이 창의 메모리(canvas)에서만 다룹니다. 서버로 보내지 않고 localStorage 에도 넣지 않습니다.
   계산(이진화·팽창·차이·연결요소·유사변환·도곽·글자 비교·BOM)은 logic.js 순수 함수입니다. */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;
  var IMG_MAX = 4000;    // 그림 파일은 긴 변을 이 크기까지 줄여 계산합니다(속도·메모리)
  var COL = { add: [214, 32, 32], del: [37, 99, 235], ink: [34, 40, 49], faint: [178, 184, 192] };

  function st() {
    if (!App.ui.cmp) {
      App.ui.cmp = {
        A: null, B: null, partA: '', partB: '', ptsA: [], ptsB: [], picking: false,
        // 기본값은 벡터(CAD) PDF 기준입니다 — 스캔 흔들림이 없어 허용치 1, 색 선까지 잡도록 어둡기 200(2026-09-29 실제 도면으로 조정)
        opt: { thr: 200, tol: 1, minArea: 8, gap: 12, fade: true, auto: true, block: false, roi: false, pdfSide: 3600 },
        view: 'side', split: 50, res: null, sel: 0, tsel: 0,
        drwA: '', drwB: '', bomA: null, bomB: null, bomKey: '', bomCols: null, bomRes: null, ecnId: ''
      };
    }
    return App.ui.cmp;
  }

  App.view('compare', function (main, parts, q) {
    var s = st(), db = App.db;
    // 주소의 ?a=·&b= (유사도 분석 비교 패널에서 넘어온 도면)는 처음 한 번만 적용합니다
    var qk = (q.a || '') + '|' + (q.b || '');
    if (qk !== '|' && s._q !== qk) {
      s._q = qk;
      if (q.a && L.findBy(db.drawings, q.a)) { s.drwA = q.a; s.partA = L.findBy(db.drawings, q.a).partNo || s.partA; }
      if (q.b && L.findBy(db.drawings, q.b)) { s.drwB = q.b; s.partB = L.findBy(db.drawings, q.b).partNo || s.partB; }
    }
    var partList = '<datalist id="partNos">' + db.drawings.map(function (d) { return '<option value="' + esc(d.partNo) + '">'; }).join('') + '</datalist>';
    var h = '<div class="page-head"><h1>도면 비교</h1><div class="actions">' +
      '<button type="button" class="btn" id="cmpSample">예시 불러오기</button>' +
      '<button type="button" class="btn" id="cmpSave"' + (s.res ? '' : ' disabled') + '>결과 PNG 저장</button>' +
      '<a class="btn btn-primary" href="#ecnOut">ECN 양식으로 내보내기</a>' +
      '<button type="button" class="btn btn-ghost" id="cmpClear">모두 비우기</button></div></div>' +
      '<div class="ok-box cmp-privacy"><strong>도면은 이 브라우저 안에서만 처리합니다.</strong> 불러온 도면 그림·BOM 은 어디에도 업로드하지 않고, 저장소(localStorage)에도 남기지 않습니다. ' +
      '비교 계산도 모두 이 PC 에서 합니다 — 인터넷이 끊겨 있어도 됩니다. 창을 닫으면 그림은 사라집니다.</div>' +
      '<p class="principle">A품번(기준) 도면과 B품번(비교 대상) 도면을 겹쳐, A와 비교해 B에서 달라진 선과 글자를 적색으로 표시합니다. 표시는 후보일 뿐이니 최종 판단은 도면을 직접 보고 해 주세요.</p>' +
      partList;

    // 1 불러오기
    var o = s.opt;
    h += '<div class="card"><h2>1 도면 불러오기</h2><div class="cmp-two">' + slot('A', s) + slot('B', s) + '</div>' +
      '<div class="form-grid" style="margin-top:8px"><label class="field"><span>PDF 해상도 (긴 변)</span><select id="pdfSide">' +
      [[2400, '2400 픽셀 — 빠름'], [3600, '3600 픽셀 — 기본'], [4800, '4800 픽셀 — 작은 글자까지']].map(function (x) {
        return '<option value="' + x[0] + '"' + (o.pdfSide === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
      }).join('') + '</select><span class="hint">바꾼 뒤 PDF 를 다시 불러와 주세요</span></label></div>' +
      '<p class="small muted">CAD 에서 내보낸 PDF 를 그대로 올려 주세요. 지정한 쪽(기본 1쪽)을 그림으로 바꾸고, PDF 안에 글자 정보가 있으면 글자끼리도 비교합니다(치수·품번 같은 글자 변경). ' +
      'PNG · JPG 그림도 됩니다. 두 도면의 용지 크기가 달라도 B를 A에 맞춰 자동으로 줄이거나 늘립니다.</p></div>';

    // 2 위치 맞추기
    var T = manualTransform(s);
    h += '<div class="card"><h2>2 위치 맞추기</h2>' +
      '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="optAuto"' + (o.auto ? ' checked' : '') + '> 자동 정렬 — 도면 테두리(도곽)를 찾아 크기·위치를 맞추고, 선이 가장 많이 겹치는 곳으로 몇 픽셀 더 옮깁니다</label>' +
      '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="optBlock"' + (o.block ? ' checked' : '') + '> 블록별 정렬 — 표가 길어져 아래 그림이 통째로 밀린 개정 도면용. 도면을 칸으로 나눠 칸마다 따로 맞춥니다(B 그림은 A 배치로 옮겨 보여 줍니다)</label>' +
      '<p class="small">같은 양식(같은 도곽)의 도면이면 자동 정렬로 충분합니다. 자동 정렬이 어긋나면 <strong>「기준점 찍기」</strong>로 두 도면의 같은 곳(도곽·표제란 모서리 등)을 A → B 순서로 2~3쌍 찍어 주세요. 기준점이 있으면 기준점을 먼저 씁니다.</p>' +
      '<div class="actions"><button type="button" class="btn' + (s.picking ? ' btn-primary' : '') + '" id="pickBtn"' + (s.A && s.B ? '' : ' disabled') + '>' + (s.picking ? '기준점 찍는 중 — 끝내기' : '기준점 찍기') + '</button>' +
      '<button type="button" class="btn btn-sm" id="pickUndo"' + (s.ptsA.length ? '' : ' disabled') + '>마지막 점 지우기</button>' +
      '<button type="button" class="btn btn-sm" id="pickClear"' + (s.ptsA.length ? '' : ' disabled') + '>기준점 모두 지우기</button></div>' +
      '<label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="optRoi"' + (o.roi ? ' checked' : '') + (s.ptsA.length >= 2 ? '' : ' disabled') + '> 기준점으로 둘러싼 범위만 비교 — 배치가 크게 바뀐 도면에서 관심 있는 부분(커넥터 한 곳, 표 하나)만 볼 때. 그 부분 둘레에 기준점을 2~3쌍 찍어 주세요</label>' +
      '<p class="small" id="alignInfo">' + esc(s.res && s.res.alignText ? s.res.alignText : alignText(s, T)) + '</p>' +
      (s.A && s.B ? '<details' + (s.picking ? ' open' : '') + '><summary class="small">기준점 찍을 그림 펼치기</summary><div class="cmp-two"><div><div class="small"><strong>A</strong> ' + esc(s.partA || s.A.name) + '</div><canvas class="cmp-canvas pickable" id="pickA"></canvas></div>' +
        '<div><div class="small"><strong>B</strong> ' + esc(s.partB || s.B.name) + '</div><canvas class="cmp-canvas pickable" id="pickB"></canvas></div></div></details>' : '<p class="muted small">두 도면을 모두 불러오면 여기에서 기준점을 찍을 수 있습니다.</p>') +
      '</div>';

    // 3 차이 계산
    h += '<div class="card"><h2>3 차이 계산</h2><div class="form-grid">' +
      rng('thr', '선으로 볼 어둡기', 60, 250, 5, o.thr, '클수록 흐린 선·색 선도 선으로 봅니다') +
      rng('tol', '흔들림 허용 (픽셀)', 0, 6, 1, o.tol, 'CAD PDF 는 0~1, 그림 파일은 2~3') +
      rng('minArea', '최소 면적 (픽셀)', 1, 200, 1, o.minArea, '이보다 작은 점 잡음은 버립니다') +
      rng('gap', '묶음 거리 (픽셀)', 0, 60, 1, o.gap, '이만큼 가까운 조각은 한 상자로 묶습니다') +
      '</div><label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="optFade"' + (o.fade ? ' checked' : '') + '> 공통 선은 흐리게 보기</label>' +
      '<div class="actions" style="margin-top:10px"><button type="button" class="btn btn-primary" id="runDiff"' + (s.A && s.B ? '' : ' disabled') + '>차이 계산</button>' +
      '<span class="small muted" id="diffInfo">' + (s.res ? esc(resText(s.res)) : '') + '</span></div></div>';

    // 4 결과
    h += '<div class="card"><div class="page-head"><h2 style="margin:0">4 결과</h2><div class="seg" role="tablist">' +
      [['side', '나란히 (A · B)'], ['overlay', '겹쳐 보기'], ['slider', '슬라이더']].map(function (v) {
        return '<button type="button" class="btn btn-sm' + (s.view === v[0] ? ' btn-primary' : '') + '" data-view="' + v[0] + '" aria-pressed="' + (s.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div></div>' +
      '<ul class="legend"><li><span class="sw sw-add"></span>적색 — B에만 있는 선·글자 (A와 비교해 추가·변경된 곳)</li>' +
      '<li><span class="sw sw-del"></span>파랑 — A에만 있는 선·글자 (B에서 사라진 곳)</li><li><span class="sw sw-mv"></span>보라 점선 — 내용은 같고 위치만 조금 옮겨진 곳</li><li><span class="sw sw-ink"></span>회색 — 두 도면 공통</li></ul>' +
      '<div id="resultBox">' + (s.res ? '' : '<p class="muted small">「차이 계산」을 누르면 결과가 여기에 나옵니다. 먼저 보고 싶으면 위의 「예시 불러오기」를 눌러 보세요.</p>') + '</div>' +
      (s.view === 'slider' && s.res ? '<label class="small" style="display:block;margin-top:8px">왼쪽 A ↔ 오른쪽 B 경계 <input type="range" id="splitR" min="0" max="100" value="' + s.split + '" style="width:100%"></label>' : '') +
      '<div id="zoomBox"></div><div id="textBox"></div><div id="regionBox"></div></div>';

    // 5 부품 표 비교 · 6 ECN 내보내기
    h += bomCard(s, db) + ecnCard(s, db);
    main.innerHTML = h;
    wire(main, s);
    if (s.A && s.B) drawPick(s);
    if (s.res) renderResult(s);
    renderBom(s);
  });

  function slot(k, s) {
    var img = s[k], part = k === 'A' ? s.partA : s.partB, db = App.db;
    var drwId = k === 'A' ? s.drwA : s.drwB;
    var canPdf = drwId && App.files[drwId];
    var info = img ? img.name + ' · ' + img.w + '×' + img.h + '픽셀' + (img.kind === 'pdf' ? (img.text && img.text.length ? ' · 글자 ' + img.text.length + '개' : ' · 글자 정보 없음(선으로 그린 글자 — 그림으로만 비교)') : '') : '아직 불러오지 않았습니다.';
    return '<div class="cmp-slot"><h3>' + (k === 'A' ? 'A품번 — 기준 도면 (변경 전)' : 'B품번 — 비교 대상 도면 (변경 후)') + '</h3>' +
      '<label class="field"><span>' + k + '품번</span><input type="text" list="partNos" id="part' + k + '" value="' + esc(part) + '" placeholder="예: HN-A0231"></label>' +
      '<div class="form-grid" style="margin-top:8px"><label class="field wide"><span>도면 파일 (PDF · PNG · JPG)</span><input type="file" id="file' + k + '" accept="application/pdf,.pdf,image/png,image/jpeg,.png,.jpg,.jpeg"></label>' +
      '<label class="field"><span>PDF 쪽 번호</span><input type="number" id="page' + k + '" min="1" value="1"></label></div>' +
      (canPdf ? '<p class="small"><button type="button" class="btn btn-sm" data-usereg="' + k + '">등록한 PDF(' + esc(L.findBy(db.drawings, drwId).fileName || drwId) + ') 불러오기</button></p>' : '') +
      '<p class="small ' + (img ? '' : 'muted') + '" id="info' + k + '">' + esc(info) + '</p></div>';
  }
  function rng(key, label, min, max, step, val, hint) {
    return '<label class="field"><span>' + esc(label) + ' <output id="out_' + key + '">' + val + '</output></span>' +
      '<input type="range" data-opt="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="hint">' + esc(hint) + '</span></label>';
  }
  function resText(r) {
    var mv = r.regions.filter(function (x) { return x.moved; }).length;
    var add = r.regions.filter(function (x) { return x.type === '추가' && !x.moved; }).length;
    var t = '선 차이: 적색(B에만) ' + add + '곳 · 파랑(A에만) ' + (r.regions.length - add - mv) + '곳' + (mv ? ' · 위치만 조금 이동 ' + mv + '곳' : '');
    if (r.text) t += ' / 글자 차이: 변경 ' + r.text.counts.변경 + ' · 추가 ' + r.text.counts.추가 + ' · 삭제 ' + r.text.counts.삭제 + ' · 이동 ' + r.text.counts.이동;
    return t;
  }

  // ── 좌표 변환 ─────────────────────────────
  function baseScale(s) { return s.A && s.B ? s.A.w / s.B.w : 1; }
  function manualTransform(s) {
    var n = Math.min(s.ptsA.length, s.ptsB.length);
    if (!s.A || !s.B) return null;
    if (!n) { var k = baseScale(s); return { a: k, b: 0, tx: 0, ty: 0, scale: k, angle: 0, rms: 0, none: true }; }
    return L.fitSimilarity(s.ptsB.slice(0, n), s.ptsA.slice(0, n), baseScale(s));
  }
  function tText(T) { return '배율 ' + T.scale.toFixed(4) + ' · 회전 ' + T.angle.toFixed(2) + '° · 이동 (' + Math.round(T.tx) + ', ' + Math.round(T.ty) + ')'; }
  function alignText(s, T) {
    if (!T) return '두 도면을 불러오면 위치 맞추기를 할 수 있습니다.';
    var n = Math.min(s.ptsA.length, s.ptsB.length);
    if (T.none) return s.opt.auto ? '기준점 없음 — 「차이 계산」 때 도곽 기준 자동 정렬을 합니다.' : '기준점 없음 — B를 A 가로 폭에 맞춰 크기만 맞춥니다. 배율 ' + T.scale.toFixed(3);
    var t = '기준점 ' + n + '쌍' + (n === 1 ? '(배율 고정·이동만)' : '') + ' — ' + tText(T);
    if (n >= 3) t += ' · 점 오차 평균 ' + T.rms.toFixed(1) + '픽셀' + (T.rms > 6 ? ' — 오차가 큽니다. 점을 다시 찍어 보세요.' : '');
    if (s.ptsA.length > s.ptsB.length) t += ' · 이제 B 도면에서 ' + s.ptsA.length + '번 점을 찍어 주세요.';
    return t;
  }

  // ── 불러오기 ─────────────────────────────
  function fitCanvas(src, w, h, name) {
    var k = Math.min(1, IMG_MAX / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { canvas: c, w: c.width, h: c.height, name: name, kind: 'image' };
  }
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () { resolve(fitCanvas(im, im.naturalWidth, im.naturalHeight, file.name)); };
        im.onerror = function () { reject(new Error('그림을 읽지 못했습니다. PNG · JPG 인지 확인해 주세요.')); };
        im.src = fr.result;
      };
      fr.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      fr.readAsDataURL(file);
    });
  }
  // PDF 한 쪽 → 그림 + 글자 목록(그림 픽셀 좌표). 글자 정보가 없는 PDF(글자를 선으로 그린 CAD 출력)는 text 가 빈 배열입니다.
  function loadPdfPage(buf, pageNo, name, side) {
    if (!App.loadPdf) return Promise.reject(new Error('PDF 라이브러리를 불러오지 못했습니다. PNG 로 저장해 올려 주세요.'));
    return App.loadPdf(buf).then(function (pdf) {
      var p = Math.min(Math.max(1, pageNo || 1), pdf.numPages);
      return pdf.getPage(p).then(function (page) {
        var vp0 = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: (side || 3600) / Math.max(vp0.width, vp0.height) });
        var c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          return page.getTextContent();
        }).then(function (tc) {
          var U = root.pdfjsLib.Util, text = [];
          tc.items.forEach(function (it) {
            if (!it.str || !String(it.str).trim()) return;
            var m = U.transform(vp.transform, it.transform);
            var hgt = Math.sqrt(m[2] * m[2] + m[3] * m[3]) || 10;
            var ang = Math.atan2(m[1], m[0]);
            var wid = (it.width || 0) * vp.scale;
            // 글자 기준선 왼쪽 끝(m[4], m[5])에서 글자 방향으로 폭의 절반, 위로 높이의 절반 → 가운데
            var cx = m[4] + Math.cos(ang) * wid / 2 + Math.sin(ang) * hgt / 2;
            var cy = m[5] + Math.sin(ang) * wid / 2 - Math.cos(ang) * hgt / 2;
            text.push({ str: String(it.str).trim(), x: cx, y: cy, h: hgt, w: wid, ang: ang });
          });
          return { canvas: c, w: c.width, h: c.height, name: name + ' (' + p + '/' + pdf.numPages + '쪽)', kind: 'pdf', text: text };
        });
      });
    });
  }
  function loadInto(s, k, file, pageNo) {
    var isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    App.toast(k + ' 도면을 불러오는 중입니다…');
    var p = isPdf ? file.arrayBuffer().then(function (buf) { return loadPdfPage(buf, pageNo, file.name, s.opt.pdfSide); }) : loadImageFile(file);
    p.then(function (img) { setImage(s, k, img); App.toast(k + ' 도면을 불러왔습니다.'); })
      .catch(function (e) { App.toast(e.message || String(e)); });
  }
  function setImage(s, k, img) {
    s[k] = img; s.ptsA = []; s.ptsB = []; s.res = null; s.picking = false; s.sel = 0; s.tsel = 0; s.sample = false;
    // 파일명에 품번이 보이면 품번 칸을 채웁니다(비어 있을 때만)
    var m = String(img.name).match(/(\d{6})[-_](\d{4,6}[A-Z]?)(?![0-9])/i);
    if (m) { var pn = m[1] + '-' + m[2].toUpperCase(); if (k === 'A' && !s.partA) s.partA = pn; if (k === 'B' && !s.partB) s.partB = pn; }
    App.rerender();
  }

  // ── 화면 연결 ─────────────────────────────
  function wire(main, s) {
    ['A', 'B'].forEach(function (k) {
      $('#file' + k, main).addEventListener('change', function () {
        var f = this.files[0]; if (!f) return;
        loadInto(s, k, f, +$('#page' + k, main).value || 1);
      });
      $('#part' + k, main).addEventListener('change', function () {
        if (k === 'A') s.partA = this.value.trim(); else s.partB = this.value.trim();
        var d = App.db.drawings.filter(function (x) { return L.norm(x.partNo) === L.norm(this.value); }, this)[0];
        if (d) { if (k === 'A') s.drwA = d.id; else s.drwB = d.id; }
        App.rerender();
      });
    });
    $$('[data-usereg]', main).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-usereg'), id = k === 'A' ? s.drwA : s.drwB, d = L.findBy(App.db.drawings, id);
        loadPdfPage(App.files[id].slice(0), +$('#page' + k, main).value || 1, d.fileName || d.partNo, s.opt.pdfSide)
          .then(function (img) { setImage(s, k, img); }).catch(function (e) { App.toast(e.message); });
      });
    });
    $('#pdfSide', main).addEventListener('change', function () { s.opt.pdfSide = +this.value; App.toast('PDF 를 다시 불러오면 새 해상도로 그립니다.'); });
    $('#cmpSample', main).addEventListener('click', function () { loadSample(s); });
    $('#cmpClear', main).addEventListener('click', function () { App.ui.cmp = null; App.go('#/compare'); });
    $('#cmpSave', main).addEventListener('click', function () { savePng(s); });
    $('#pickBtn', main).addEventListener('click', function () { s.picking = !s.picking; App.rerender(); });
    $('#pickUndo', main).addEventListener('click', function () {
      if (s.ptsA.length > s.ptsB.length) s.ptsA.pop(); else { s.ptsB.pop(); s.ptsA.pop(); }
      s.res = null; App.rerender();
    });
    $('#pickClear', main).addEventListener('click', function () { s.ptsA = []; s.ptsB = []; s.res = null; App.rerender(); });
    ['A', 'B'].forEach(function (k) {
      var c = $('#pick' + k, main);
      if (c) c.addEventListener('click', function (ev) { pickPoint(s, k, c, ev); });
    });
    $('#optAuto', main).addEventListener('change', function () { s.opt.auto = this.checked; if (s.res) compute(s); else App.rerender(); });
    $('#optRoi', main).addEventListener('change', function () { s.opt.roi = this.checked; if (s.res) compute(s); else App.rerender(); });
    $('#optBlock', main).addEventListener('change', function () { s.opt.block = this.checked; if (s.res) compute(s); else App.rerender(); });
    $$('[data-opt]', main).forEach(function (r) {
      r.addEventListener('input', function () { $('#out_' + r.getAttribute('data-opt'), main).textContent = r.value; });
      r.addEventListener('change', function () { s.opt[r.getAttribute('data-opt')] = +r.value; if (s.res) recompute(s); });
    });
    $('#optFade', main).addEventListener('change', function () { s.opt.fade = this.checked; if (s.res) { s.res.cache = {}; renderResult(s); } });
    $('#runDiff', main).addEventListener('click', function () {
      var b = this; b.disabled = true; b.textContent = '계산 중…';
      setTimeout(function () { compute(s); }, 30);
    });
    $$('[data-view]', main).forEach(function (b) {
      b.addEventListener('click', function () { s.view = b.getAttribute('data-view'); App.rerender(); });
    });
    var sr = $('#splitR', main);
    if (sr) sr.addEventListener('input', function () { s.split = +sr.value; renderResult(s); });
    wireBom(main, s);
    wireEcn(main, s);
  }

  function pickPoint(s, k, c, ev) {
    if (!s.picking) { App.toast('먼저 「기준점 찍기」를 눌러 주세요.'); return; }
    var r = c.getBoundingClientRect();
    var img = s[k];
    var p = { x: (ev.clientX - r.left) * img.w / r.width, y: (ev.clientY - r.top) * img.h / r.height };
    if (k === 'A') {
      if (s.ptsA.length > s.ptsB.length) { App.toast('B 도면에서 ' + s.ptsA.length + '번 점을 먼저 찍어 주세요.'); return; }
      s.ptsA.push(p);
    } else {
      if (s.ptsB.length >= s.ptsA.length) { App.toast('A 도면에 먼저 점을 찍어 주세요 (A → B 순서).'); return; }
      s.ptsB.push(p);
    }
    s.res = null;
    App.rerender();
  }

  function drawPick(s) {
    ['A', 'B'].forEach(function (k) {
      var c = $('#pick' + k), img = s[k];
      if (!c) return;
      // 기준점 그림은 가볍게: 긴 변 1600 으로 줄여 그리고, 점 좌표는 원래 크기 기준으로 둡니다
      var k2 = Math.min(1, 1600 / Math.max(img.w, img.h));
      c.width = Math.round(img.w * k2); c.height = Math.round(img.h * k2);
      var ctx = c.getContext('2d');
      ctx.drawImage(img.canvas, 0, 0, c.width, c.height);
      var pts = k === 'A' ? s.ptsA : s.ptsB, rad = Math.max(8, c.width / 90);
      pts.forEach(function (p, i) {
        var x = p.x * k2, y = p.y * k2;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234,120,0,.25)'; ctx.fill();
        ctx.lineWidth = Math.max(2, rad / 4); ctx.strokeStyle = '#c05f00'; ctx.stroke();
        ctx.font = 'bold ' + Math.round(rad * 1.6) + 'px sans-serif'; ctx.fillStyle = '#c05f00';
        ctx.fillText(String(i + 1), x + rad + 3, y - rad);
      });
    });
  }

  // ── 계산 ────────────────────────────────
  function warpB(s, T, W, H) {
    var cb = document.createElement('canvas'); cb.width = W; cb.height = H;
    var ctx = cb.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // canvas setTransform(a, b, c, d, e, f): x' = a·x + c·y + e, y' = b·x + d·y + f
    ctx.setTransform(T.a, T.b, -T.b, T.a, T.tx, T.ty);
    ctx.drawImage(s.B.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return L.binarize(ctx.getImageData(0, 0, W, H).data, W, H, s.opt.thr);
  }
  function compute(s) {
    if (!s.A || !s.B) return;
    var W = s.A.w, H = s.A.h, o = s.opt;
    var mA = L.binarize(s.A.canvas.getContext('2d').getImageData(0, 0, W, H).data, W, H, o.thr);
    var T = manualTransform(s), how;
    if (!T.none) how = '기준점 ' + Math.min(s.ptsA.length, s.ptsB.length) + '쌍';
    else if (o.auto) {
      var mB0 = L.binarize(s.B.canvas.getContext('2d').getImageData(0, 0, s.B.w, s.B.h).data, s.B.w, s.B.h, o.thr);
      var fA = L.findFrame(mA, W, H), fB = L.findFrame(mB0, s.B.w, s.B.h);
      var TF = fA && fB && fA.kind === 'frame' && fB.kind === 'frame' ? L.frameTransform(fB, fA) : null;
      // 도곽으로 구한 배율이 용지 비율과 크게 다르면(도곽을 잘못 찾음) 용지 크기 맞춤으로 돌아갑니다
      if (TF && Math.abs(TF.scale / baseScale(s) - 1) < 0.15 && Math.abs(TF.angle) < 3) { T = TF; how = '도곽 자동 정렬'; }
      else how = fA && fB && fA.kind === 'frame' && fB.kind === 'frame' ? '도곽이 서로 달라 용지 크기로 맞춤' : '도곽을 찾지 못해 용지 크기로 맞춤';
    } else how = '용지 크기로 맞춤';
    var mB = warpB(s, T, W, H);
    var shiftNote = '';
    if (o.auto) {
      var sh = L.bestShift(mA, mB, W, H, 8);
      if (sh.dx || sh.dy) {
        T = L.composeShift(T, sh.dx, sh.dy);
        mB = warpB(s, T, W, H);
      }
      shiftNote = ' + 미세 이동 (' + sh.dx + ', ' + sh.dy + ')픽셀 — 선 겹침 ' + Math.round(sh.base * 1000) / 10 + '% → ' + Math.round(sh.score * 1000) / 10 + '%';
    }
    var block = null;
    if (o.block) {
      // 칸 크기·찾는 범위는 그림 크기에 비례(3600 픽셀 기준 192 · 160)
      block = L.blockAlign(mA, mB, W, H, { tile: Math.round(W / 18.75), R: Math.round(W / 22.5), factor: Math.max(2, Math.round(W / 600)) });
      mB = block.warped;
      var nm = 0; for (var bi = 0; bi < block.dx.length; bi++) if (block.dx[bi] || block.dy[bi]) nm++;
      shiftNote += ' · 블록별 정렬: ' + block.cols * block.rows + '칸 중 ' + nm + '칸을 따로 옮김';
    }
    var diff = L.diffMasks(mA, mB, W, H, o.tol);
    var roi = o.roi && s.ptsA.length >= 2 ? L.pointsBox(s.ptsA) : null;
    if (roi) { L.clipDiff(diff, W, H, roi); shiftNote += ' · 비교 범위: 기준점 둘레만'; }
    var regions = block ? L.diffRegions(diff, W, H, { minArea: o.minArea, gap: o.gap }) : regionsFor(mA, mB, diff, W, H, o);
    var text = null;
    if (s.A.text && s.B.text && s.A.text.length && s.B.text.length) {
      var tb = s.B.text.map(function (t) { var p = L.applySimilarity(T, t); return { str: t.str, x: p.x, y: p.y, h: t.h * (T.scale || 1), w: t.w * (T.scale || 1), ang: t.ang }; });
      var inRoi = function (t) { return !roi || (t.x >= roi.x0 && t.x <= roi.x1 && t.y >= roi.y0 && t.y <= roi.y1); };
      text = L.textDiff(s.A.text.filter(inRoi), tb.filter(inRoi), { radius: 1.2, minRadius: 6 });
    }
    s.res = { thr: o.thr, block: !!block, roi: roi, W: W, H: H, mA: mA, mB: mB, diff: diff, regions: regions, T: T, text: text, at: new Date(), cache: {},
      alignText: how + ' — ' + tText(T) + shiftNote };
    s.sel = 0; s.tsel = 0;
    App.rerender();
  }
  // 차이 영역 + 「위치만 조금 옮겨진 영역」 표시(표·블록이 몇 mm 밀린 경우 — 값이 바뀐 것과 구분)
  function regionsFor(mA, mB, diff, W, H, o) {
    var regions = L.diffRegions(diff, W, H, { minArea: o.minArea, gap: o.gap });
    var dA = L.dilate(mA, W, H, o.tol), dB = L.dilate(mB, W, H, o.tol);
    return L.markMoved(regions, mA, mB, dA, dB, W, H, Math.max(6, Math.round(W / 240)));
  }
  // 허용치·면적 등만 바뀌면 정렬은 다시 하지 않습니다
  function recompute(s) {
    var r = s.res, o = s.opt;
    if (!r) return;
    if (r.thr !== o.thr) { compute(s); return; }
    r.diff = L.clipDiff(L.diffMasks(r.mA, r.mB, r.W, r.H, o.tol), r.W, r.H, r.roi);
    r.regions = r.block ? L.diffRegions(r.diff, r.W, r.H, { minArea: o.minArea, gap: o.gap }) : regionsFor(r.mA, r.mB, r.diff, r.W, r.H, o);
    r.cache = {}; s.sel = 0;
    App.rerender();
  }

  // 마스크 → 그림(상자 없이). which: 'overlay' | 'A' | 'B'. 한 번 그리면 res.cache 에 둡니다.
  function paintBase(s, which) {
    var r = s.res;
    if (r.cache[which]) return r.cache[which];
    var W = r.W, H = r.H, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d'), im = ctx.createImageData(W, H), d = im.data;
    var ink = s.opt.fade ? COL.faint : COL.ink;
    var add = r.diff.added, del = r.diff.removed, mA = r.mA, mB = r.mB;
    for (var i = 0; i < W * H; i++) {
      var col = null;
      if (which === 'overlay') {
        if (add[i]) col = COL.add; else if (del[i]) col = COL.del; else if (mA[i] || mB[i]) col = ink;
      } else if (which === 'B') {
        if (add[i]) col = COL.add; else if (mB[i]) col = ink; else if (del[i]) col = [196, 214, 250];
      } else {
        if (del[i]) col = COL.del; else if (mA[i]) col = ink;
      }
      var p = i * 4;
      if (col) { d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; } else { d[p] = d[p + 1] = d[p + 2] = 255; }
      d[p + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    r.cache[which] = c;
    return c;
  }
  function paint(s, which) {
    var base = paintBase(s, which), c = document.createElement('canvas');
    c.width = base.width; c.height = base.height;
    var ctx = c.getContext('2d');
    ctx.drawImage(base, 0, 0);
    if (s.res.roi) {
      var q = s.res.roi; ctx.lineWidth = Math.max(2, s.res.W / 800); ctx.strokeStyle = 'rgb(234,120,0)'; ctx.setLineDash([12, 8]);
      ctx.strokeRect(q.x0, q.y0, q.x1 - q.x0, q.y1 - q.y0); ctx.setLineDash([]);
    }
    drawBoxes(ctx, s, which);
    drawTextBoxes(ctx, s, which);
    return c;
  }
  function drawBoxes(ctx, s, which) {
    var W = s.res.W, pad = Math.max(4, Math.round(W / 300)), lw = Math.max(2, Math.round(W / 900));
    var fs = Math.max(12, Math.round(W / 110));
    ctx.font = 'bold ' + fs + 'px sans-serif';
    s.res.regions.forEach(function (g) {
      if (which === 'A' && g.type === '추가') return;
      if (which === 'B' && g.type === '삭제' && g.moved) return;
      var col = g.moved ? 'rgb(126,34,206)' : g.type === '추가' ? 'rgb(214,32,32)' : 'rgb(37,99,235)';
      var on = s.sel === g.no;
      ctx.lineWidth = on ? lw * 3 : lw;
      ctx.strokeStyle = col;
      ctx.setLineDash(g.type === '삭제' || g.moved ? [lw * 3, lw * 2] : []);
      ctx.strokeRect(g.x - pad, g.y - pad, g.w + pad * 2, g.h + pad * 2);
      ctx.setLineDash([]);
      var label = String(g.no), tw = ctx.measureText(label).width + 8;
      var ly = Math.max(0, g.y - pad - fs - 4);
      ctx.fillStyle = col; ctx.fillRect(g.x - pad, ly, tw, fs + 4);
      ctx.fillStyle = '#fff'; ctx.fillText(label, g.x - pad + 4, ly + fs);
    });
  }
  // 글자 차이: 글자 둘레에 두꺼운 테두리 + 「T번호」 꼬리표. 변경·추가 = 적색, 삭제 = 파랑, 이동 = 보라
  function textRect(t) {
    var w = Math.max(t.w || 0, t.h * Math.max(1, t.str.length) * 0.55), h = t.h;
    var vertical = t.ang != null && Math.abs(Math.sin(t.ang)) > 0.7;
    var bw = vertical ? h : w, bh = vertical ? w : h;
    return { x: t.x - bw / 2, y: t.y - bh / 2, w: bw, h: bh };
  }
  function drawTextBoxes(ctx, s, which) {
    var tx = s.res.text; if (!tx) return;
    var W = s.res.W, lw = Math.max(2, Math.round(W / 700)), fs = Math.max(12, Math.round(W / 110));
    ctx.font = 'bold ' + fs + 'px sans-serif';
    tx.list.forEach(function (d) {
      var col = d.type === '삭제' ? 'rgb(37,99,235)' : d.type === '이동' ? 'rgb(126,34,206)' : 'rgb(214,32,32)';
      var t = which === 'A' ? d.a : (d.b || d.a);
      if (d.type === '이동' && !s.showMoved) return;
      if (!t || (which === 'A' && d.type === '추가') || (which === 'B' && d.type === '삭제')) return;
      // 글꼴마다 글자 상자와 실제 글자 모양이 조금 어긋나(세로 글자에서 특히) 테두리를 넉넉히 둡니다
      var r = textRect(t), pad = Math.max(4, t.h * 0.6), on = s.tsel === d.no;
      ctx.lineWidth = on ? lw * 3 : lw * 1.5; ctx.strokeStyle = col;
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
      // 꼬리표는 글자를 가리지 않게 테두리 바깥 위쪽에 붙입니다
      var label = 'T' + d.no, tw = ctx.measureText(label).width + 8;
      var ly = r.y - pad - fs - 6 < 0 ? r.y + r.h + pad + 2 : r.y - pad - fs - 6;
      ctx.fillStyle = col; ctx.fillRect(r.x - pad, ly, tw, fs + 4);
      ctx.fillStyle = '#fff'; ctx.fillText(label, r.x - pad + 4, ly + fs);
    });
  }

  function renderResult(s) {
    var box = $('#resultBox'); if (!box || !s.res) return;
    box.innerHTML = '';
    if (s.view === 'side') {
      var g = document.createElement('div'); g.className = 'cmp-two';
      [['A', 'A ' + (s.partA || s.A.name) + ' (변경 전) — 파랑 = B에서 사라진 것'], ['B', 'B ' + (s.partB || s.B.name) + ' (변경 후' + (s.res.block ? ' · A 배치로 옮김' : '') + ') — 적색 = A와 달라진 것']].forEach(function (x) {
        var w = document.createElement('div');
        w.innerHTML = '<div class="small"><strong>' + esc(x[1]) + '</strong></div>';
        var c = paint(s, x[0]); c.className = 'cmp-canvas'; w.appendChild(c); g.appendChild(w);
      });
      box.appendChild(g);
    } else if (s.view === 'slider') {
      var c2 = sliderCanvas(s); c2.className = 'cmp-canvas'; box.appendChild(c2);
    } else {
      var c3 = paint(s, 'overlay'); c3.className = 'cmp-canvas'; box.appendChild(c3);
    }
    renderZoom(s);
    renderText(s);
    renderRegions(s);
  }
  function sliderCanvas(s) {
    var a = paint(s, 'A'), b = paint(s, 'B'), W = s.res.W, H = s.res.H;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'), x = Math.round(W * s.split / 100);
    ctx.drawImage(a, 0, 0);
    ctx.drawImage(b, x, 0, W - x, H, x, 0, W - x, H);
    ctx.fillStyle = '#1d5a9e'; ctx.fillRect(x - 2, 0, 4, H);
    ctx.font = 'bold ' + Math.max(14, Math.round(W / 70)) + 'px sans-serif';
    ctx.fillText('A', Math.max(4, x - 30), 30); ctx.fillText('B', Math.min(W - 24, x + 12), 30);
    return c;
  }
  // 고른 차이(선 상자 또는 글자)를 A·B 나란히 크게 잘라 보여 줍니다 — 도면이 크면 전체 그림에서는 글자가 안 읽힙니다
  function focusRect(s) {
    var r = s.res;
    if (s.tsel && r.text) {
      var d = r.text.list[s.tsel - 1], t = d.b || d.a, q0 = textRect(t), pp = t.h * 0.6, q = { x: q0.x - pp, y: q0.y - pp, w: q0.w + pp * 2, h: q0.h + pp * 2 };
      return { x: q.x, y: q.y, w: q.w, h: q.h, col: d.type === '삭제' ? 'rgb(37,99,235)' : 'rgb(214,32,32)', title: 'T' + d.no + ' ' + d.type + ' — ' + (d.a ? d.a.str : '') + (d.a && d.b ? ' → ' : '') + (d.b ? d.b.str : '') };
    }
    if (s.sel) {
      var g = r.regions[s.sel - 1];
      return { x: g.x, y: g.y, w: g.w, h: g.h, col: g.moved ? 'rgb(126,34,206)' : g.type === '추가' ? 'rgb(214,32,32)' : 'rgb(37,99,235)', title: g.no + '번 ' + (g.moved ? '위치만 이동' : g.type === '추가' ? 'B에만 (적색)' : 'A에만 (파랑)') };
    }
    return null;
  }
  function renderZoom(s) {
    var box = $('#zoomBox'); if (!box) return;
    var f = focusRect(s);
    if (!f) { box.innerHTML = s.res.regions.length || s.res.text ? '<p class="small muted" style="margin-top:8px">아래 목록에서 줄을 누르면 그 부분을 A · B 나란히 크게 보여 줍니다.</p>' : ''; return; }
    var r = s.res, m = Math.max(80, Math.max(f.w, f.h) * 1.2);
    var x0 = Math.max(0, Math.round(f.x - m)), y0 = Math.max(0, Math.round(f.y - m));
    var x1 = Math.min(r.W, Math.round(f.x + f.w + m)), y1 = Math.min(r.H, Math.round(f.y + f.h + m));
    var cw = x1 - x0, chh = y1 - y0, k = Math.min(3, 520 / Math.max(cw, chh));
    box.innerHTML = '<h3 style="margin-top:14px">확대 — ' + esc(f.title) + '</h3><div class="cmp-two" id="zoomPair"></div>';
    var pair = $('#zoomPair', box);
    [['A', 'A (변경 전)'], ['B', 'B (변경 후)']].forEach(function (x) {
      // 확대 그림에는 번호 꼬리표 없이 고른 곳 테두리만 그립니다(꼬리표가 글자를 가리지 않게)
      var src = paintBase(s, x[0]), c = document.createElement('canvas');
      c.width = Math.round(cw * k); c.height = Math.round(chh * k);
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = k < 1;
      ctx.drawImage(src, x0, y0, cw, chh, 0, 0, c.width, c.height);
      var pd = 6;
      ctx.lineWidth = 2; ctx.strokeStyle = f.col; ctx.setLineDash([6, 4]);
      ctx.strokeRect((f.x - x0) * k - pd, (f.y - y0) * k - pd, f.w * k + pd * 2, f.h * k + pd * 2);
      var w = document.createElement('div');
      w.innerHTML = '<div class="small"><strong>' + x[1] + '</strong></div>';
      c.className = 'cmp-canvas'; w.appendChild(c); pair.appendChild(w);
    });
  }
  function renderText(s) {
    var box = $('#textBox'); if (!box) return;
    var tx = s.res.text;
    if (!tx) {
      var why = (s.A.kind === 'pdf' && !(s.A.text || []).length) || (s.B.kind === 'pdf' && !(s.B.text || []).length) ? 'PDF 에 글자 정보가 없어(글자를 선으로 그린 CAD 출력)' : '두 도면 중 하나가 그림 파일이라';
      box.innerHTML = '<p class="small muted" style="margin-top:12px">글자 비교는 하지 않았습니다 — ' + why + ' 선 비교로만 찾습니다. 치수 글자가 바뀌어도 선 비교에서 적색 상자로 잡힙니다.</p>';
      return;
    }
    var rows = tx.list.filter(function (d) { return d.type !== '이동' || s.showMoved; });
    box.innerHTML = '<h3 style="margin-top:14px">글자 차이 ' + tx.list.length + '건 <span class="small muted">(변경 ' + tx.counts.변경 + ' · 추가 ' + tx.counts.추가 + ' · 삭제 ' + tx.counts.삭제 + ' · 이동 ' + tx.counts.이동 + ' / 같은 글자 ' + tx.same + '개)</span></h3>' +
      '<p class="small muted">PDF 안의 글자를 같은 자리끼리 맞대어 본 결과입니다. 「변경」은 같은 자리의 값이 바뀐 것(예: 길이 350 → 450)이고, 「이동」은 같은 글자가 다른 자리로 옮겨진 것입니다.' +
      ' <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="showMoved"' + (s.showMoved ? ' checked' : '') + '> 이동도 목록에 보이기</label></p>' +
      App.table([
        { label: '번호', render: function (d) { return '<strong>T' + d.no + '</strong>'; } },
        { label: '구분', render: function (d) { return '<span class="badge ' + (d.type === '삭제' ? 'b-info' : d.type === '이동' ? 'b-muted' : 'b-danger') + '">' + d.type + '</span>'; } },
        { label: 'A (변경 전)', render: function (d) { return d.a ? esc(d.a.str) : ''; } },
        { label: 'B (변경 후)', render: function (d) { return d.b ? '<strong class="' + (d.type === '이동' ? '' : 't-add') + '">' + esc(d.b.str) + '</strong>' : ''; } },
        { label: '위치 (x, y)', render: function (d) { var t = d.b || d.a; return Math.round(t.x) + ', ' + Math.round(t.y); } }
      ], rows, { empty: '표시할 글자 차이가 없습니다.', rowAttr: function (d) { return 'data-treg="' + d.no + '" class="clickable' + (s.tsel === d.no ? ' sel' : '') + '"'; } });
    $$('[data-treg]', box).forEach(function (tr) {
      tr.addEventListener('click', function () { var n = +tr.getAttribute('data-treg'); s.tsel = s.tsel === n ? 0 : n; s.sel = 0; renderResult(s); });
    });
    $('#showMoved', box).addEventListener('change', function () { s.showMoved = this.checked; renderText(s); });
  }
  function renderRegions(s) {
    var box = $('#regionBox'); if (!box) return;
    var r = s.res;
    if (!r.regions.length) { box.innerHTML = '<div class="ok-box" style="margin-top:12px">지금 설정으로는 선 차이 영역이 없습니다. 흔들림 허용을 줄이거나 최소 면적을 낮춰 다시 계산해 볼 수 있습니다.</div>'; return; }
    box.innerHTML = '<h3 style="margin-top:14px">선 차이 영역 ' + r.regions.length + '곳</h3><p class="small muted">줄을 누르면 위에 A · B 를 나란히 크게 보여 주고, 그림의 상자를 굵게 표시합니다. 좌표는 A 도면 기준 픽셀(왼쪽 위가 0, 0)입니다.</p>' +
      App.table([
        { label: '번호', render: function (g) { return '<strong>' + g.no + '</strong>'; } },
        { label: '구분', render: function (g) {
          if (g.moved) return '<span class="badge b-muted">위치만 이동 (' + g.moved.dx + ', ' + g.moved.dy + ')</span>';
          return g.type === '추가' ? '<span class="badge b-danger">B에만 (적색)</span>' : '<span class="badge b-info">A에만 (파랑)</span>'; } },
        { label: '위치 (x, y)', render: function (g) { return g.x + ', ' + g.y; } },
        { label: '크기 (가로×세로)', render: function (g) { return g.w + '×' + g.h; } },
        { label: '면적 (선 픽셀)', key: 'area', cls: 'num' }
      ], r.regions, { rowAttr: function (g) { return 'data-reg="' + g.no + '" class="clickable' + (s.sel === g.no ? ' sel' : '') + '"'; } }) +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-sm" id="regXlsx">차이 목록 (엑셀)</button></div>';
    $$('[data-reg]', box).forEach(function (tr) {
      tr.addEventListener('click', function () { var n = +tr.getAttribute('data-reg'); s.sel = s.sel === n ? 0 : n; s.tsel = 0; renderResult(s); });
    });
    $('#regXlsx', box).addEventListener('click', function () {
      App.downloadXlsx('도면비교_차이목록', [{ name: '선 차이', rows: regionRows(s) }].concat(s.res.text ? [{ name: '글자 차이', rows: textRows(s) }] : []));
    });
  }
  function regionRows(s) {
    var rows = [['A품번', s.partA, 'B품번', s.partB], ['번호', '구분', 'x', 'y', '가로', '세로', '면적(픽셀)']];
    s.res.regions.forEach(function (g) { rows.push([g.no, g.moved ? '위치만 이동(' + g.moved.dx + ',' + g.moved.dy + ')' : g.type === '추가' ? 'B에만(적색)' : 'A에만(파랑)', g.x, g.y, g.w, g.h, g.area]); });
    return rows;
  }
  function textRows(s) {
    var rows = [['번호', '구분', 'A (변경 전)', 'B (변경 후)', 'x', 'y']];
    s.res.text.list.forEach(function (d) { var t = d.b || d.a; rows.push(['T' + d.no, d.type, d.a ? d.a.str : '', d.b ? d.b.str : '', Math.round(t.x), Math.round(t.y)]); });
    return rows;
  }

  // 저장용 그림: 위에 품번·범례 띠를 붙입니다. maxW 를 주면 그 폭으로 줄입니다(엑셀용).
  function resultImage(s, view, maxW) {
    var body;
    if (view === 'side') {
      var a = paint(s, 'A'), b = paint(s, 'B'), gap = Math.round(a.width / 60);
      body = document.createElement('canvas'); body.width = a.width + b.width + gap; body.height = Math.max(a.height, b.height);
      var bx = body.getContext('2d'); bx.fillStyle = '#fff'; bx.fillRect(0, 0, body.width, body.height);
      bx.drawImage(a, 0, 0); bx.drawImage(b, a.width + gap, 0);
      bx.fillStyle = '#1d5a9e'; bx.fillRect(a.width + gap / 2 - 2, 0, 4, body.height);
    } else body = view === 'slider' ? sliderCanvas(s) : paint(s, 'overlay');
    var k = maxW ? Math.min(1, maxW / body.width) : 1;
    var fs = Math.max(14, Math.round(body.width * k / 70)), head = fs * 3 + 12;
    var c = document.createElement('canvas');
    c.width = Math.round(body.width * k); c.height = Math.round(body.height * k) + head;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(body, 0, head, c.width, c.height - head);
    ctx.fillStyle = '#1a2330'; ctx.font = 'bold ' + fs + 'px sans-serif';
    ctx.fillText('도면 비교 — A ' + (s.partA || s.A.name) + ' (변경 전)  vs  B ' + (s.partB || s.B.name) + ' (변경 후)', 8, fs + 4);
    ctx.font = Math.round(fs * 0.8) + 'px sans-serif';
    var y2 = fs * 2 + 10, x = 8;
    [['rgb(214,32,32)', '적색 = B에만 있는 선·글자'], ['rgb(37,99,235)', '파랑 = A에만 있는 선·글자'],
      ['#566170', '선 차이 ' + s.res.regions.length + '곳' + (s.res.text ? ' · 글자 변경 ' + s.res.text.counts.변경 + '건' : '') + ' · ' + L.toDateTimeStr(new Date()) + ' · 자동 표시는 후보이며 최종 판단은 담당자']].forEach(function (p) {
      ctx.fillStyle = p[0]; ctx.fillText(p[1], x, y2); x += ctx.measureText(p[1]).width + fs;
    });
    return c;
  }
  function savePng(s) {
    if (!s.res) return;
    resultImage(s, s.view).toBlob(function (blob) {
      var name = '도면비교_' + safe(s.partA || 'A') + '_vs_' + safe(s.partB || 'B') + '_' + L.toDateStr(new Date()).replace(/-/g, '') + '.png';
      if (s.sample) name = '예시데이터_' + name;
      downloadBlob(blob, name);
    }, 'image/png');
  }
  function downloadBlob(blob, name) {
    var aEl = document.createElement('a');
    aEl.href = URL.createObjectURL(blob); aEl.download = name;
    document.body.appendChild(aEl); aEl.click();
    setTimeout(function () { URL.revokeObjectURL(aEl.href); aEl.remove(); }, 1000);
  }
  function safe(x) { return String(x).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }

  // ── 5 부품 표 비교 ─────────────────────────
  function bomCard(s, db) {
    var opts = function (sel) {
      return '<option value="">— 고르기 —</option>' + db.drawings.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (sel === d.id ? ' selected' : '') + '>' + esc(App.drawingLabel(d) + ' (' + d.id + ')') + '</option>';
      }).join('');
    };
    var h = '<div class="card"><h2>5 부품 표 (BOM) 비교</h2>' +
      '<p class="small">A품번·B품번의 BOM 을 품목코드끼리 맞대어 봅니다. <span class="t-add">적색 = B에서 추가·변경</span> · <span class="t-del">파랑 취소선 = B에서 삭제</span>. 이 표도 브라우저 안에서만 읽습니다.</p>' +
      '<div class="cmp-two">' + ['A', 'B'].map(function (k) {
        var t = s['bom' + k];
        return '<div><label class="field"><span>' + k + ' BOM 파일 (xlsx · csv)</span><input type="file" id="bomFile' + k + '" accept=".xlsx,.xls,.csv"></label>' +
          '<label class="field" style="margin-top:6px"><span>또는 엑셀에서 머리행까지 복사해 붙여 넣기</span><textarea id="bomText' + k + '" placeholder="품목코드&#9;품목명&#9;규격&#9;단위&#9;수량 …">' + esc(t && t.text ? t.text : '') + '</textarea></label>' +
          '<p class="small muted" id="bomInfo' + k + '">' + (t ? esc(bomInfo(t)) : '') + '</p></div>';
      }).join('') + '</div>' +
      '<div class="actions"><label class="field" style="min-width:180px"><span>기준 열 (품번)</span><select id="bomKey"></select></label>' +
      '<div class="field" style="min-width:240px"><span>비교할 열</span><div id="bomCols" class="chk-row small"></div></div></div>' +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-primary" id="bomRun">표 비교</button>' +
      '<button type="button" class="btn" id="bomSample">예시 BOM 넣기</button>' +
      '<button type="button" class="btn" id="bomXlsx"' + (s.bomRes ? '' : ' disabled') + '>비교 결과 (엑셀)</button></div>' +
      '<div id="bomDiff"></div>' +
      '<h3 style="margin-top:16px">등록한 도면 정보로 비교</h3>' +
      (db.drawings.length ? '<div class="form-grid"><label class="field"><span>A 도면</span><select id="drwA">' + opts(s.drwA) + '</select></label>' +
        '<label class="field"><span>B 도면</span><select id="drwB">' + opts(s.drwB) + '</select></label></div>' +
        '<p class="small muted">도면 정보(품명·REV·고객사·기종·사용처·회로 수·분기 수)와 주요 커넥터·전선·구조 키워드 목록을 비교합니다.</p><div id="drwDiff"></div>'
        : '<p class="muted small">등록된 도면이 없습니다. 「도면 등록」에서 올리면 여기서 고를 수 있습니다.</p>') +
      '</div>';
    return h;
  }
  function bomInfo(t) { return t.label + ' · ' + t.rows.length + '행' + (t.partNo ? ' · 품번 ' + t.partNo : '') + (t.headerRow > 1 ? ' · 머리행 ' + t.headerRow + '행' : ''); }
  function commonHeaders(s) {
    var ha = s.bomA ? s.bomA.headers : [], hb = s.bomB ? s.bomB.headers : [];
    var hs = ha.filter(function (x) { return hb.indexOf(x) >= 0; });
    return hs.length ? hs : (ha.length ? ha : hb);
  }
  function fillKeySel(s) {
    var sel = $('#bomKey'); if (!sel) return;
    var hs = commonHeaders(s);
    if (!s.bomKey || hs.indexOf(s.bomKey) < 0) s.bomKey = L.guessKeyColumn(hs);
    sel.innerHTML = hs.map(function (x) { return '<option' + (x === s.bomKey ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') || '<option value="">표를 먼저 넣어 주세요</option>';
    // 머리행 구성이나 기준 열이 바뀌면 비교할 열을 기본값으로 다시 고릅니다
    var sig = hs.join('|') + '#' + s.bomKey;
    if (!s.bomCols || s.bomColsFor !== sig) { s.bomCols = L.defaultCompareCols(hs, s.bomKey); s.bomColsFor = sig; }
    var box = $('#bomCols');
    box.innerHTML = hs.filter(function (x) { return x !== s.bomKey; }).map(function (x) {
      return '<label><input type="checkbox" data-bcol="' + esc(x) + '"' + (s.bomCols.indexOf(x) >= 0 ? ' checked' : '') + '> ' + esc(x) + '</label>';
    }).join('') || '<span class="muted">—</span>';
    $$('[data-bcol]', box).forEach(function (c) {
      c.addEventListener('change', function () {
        var v = c.getAttribute('data-bcol');
        s.bomCols = s.bomCols.filter(function (x) { return x !== v; });
        if (c.checked) s.bomCols.push(v);
      });
    });
  }
  function setBom(s, k, t) {
    s['bom' + k] = t; s.bomRes = null;
    if (t && t.partNo) { if (k === 'A' && !s.partA) s.partA = t.partNo; if (k === 'B' && !s.partB) s.partB = t.partNo; }
    var inf = $('#bomInfo' + k); if (inf) inf.textContent = t ? bomInfo(t) : '';
    fillKeySel(s);
  }
  function runBom(s) {
    if (!s.bomA || !s.bomB) { App.toast('A · B 표를 모두 넣어 주세요.'); return; }
    s.bomRes = L.tableDiff(s.bomA.rows, s.bomB.rows, { key: s.bomKey, cols: s.bomCols.slice() });
    s.bomRes.reps = L.replacementCandidates(s.bomRes);
    renderBom(s); var bx = $('#bomXlsx'); if (bx) bx.disabled = false;
    var bm = $('#toEcnMat'); if (bm) bm.disabled = false;
  }
  function wireBom(main, s) {
    ['A', 'B'].forEach(function (k) {
      var da = $('#drw' + k, main);
      if (da) da.addEventListener('change', function () { s['drw' + k] = this.value; var d = L.findBy(App.db.drawings, this.value); if (d) s['part' + k] = d.partNo; App.rerender(); });
      $('#bomFile' + k, main).addEventListener('change', function () {
        var f = this.files[0]; if (!f || !App.xlsxReady()) return;
        f.arrayBuffer().then(function (buf) {
          var wb = root.XLSX.read(buf, { type: 'array' });
          var name = wb.SheetNames.filter(function (n) { return root.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).length; })[0];
          if (!name) { App.toast('읽을 행이 없습니다.'); return; }
          var p = L.parseBomSheet(root.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }));
          if (!p.rows.length) { App.toast('품목 행을 찾지 못했습니다. 머리행(품목코드 등)이 있는지 확인해 주세요.'); return; }
          setBom(s, k, { label: f.name, headers: p.headers, rows: p.rows, partNo: p.partNo, partName: p.partName, headerRow: p.headerRow });
          $('#bomText' + k).value = '';
          App.toast(k + ' BOM ' + p.rows.length + '행을 읽었습니다.');
        }).catch(function (e) { App.toast('표를 읽지 못했습니다: ' + e.message); });
      });
      $('#bomText' + k, main).addEventListener('change', function () {
        var p = L.parsePastedTable(this.value);
        setBom(s, k, p.headers.length ? { label: '붙여 넣은 표', headers: p.headers, rows: p.rows, text: this.value, headerRow: 1 } : null);
      });
    });
    fillKeySel(s);
    $('#bomKey', main).addEventListener('change', function () { s.bomKey = this.value; s.bomCols = null; fillKeySel(s); });
    $('#bomRun', main).addEventListener('click', function () { runBom(s); });
    $('#bomSample', main).addEventListener('click', function () {
      // 수강생 BOM 양식과 같은 열(품목코드·품목명·규격·단위·수량), 값은 가상
      var A = '품목코드\t품목명\t규격\t단위\t수량\nCN-0221\tCONNECTOR 12P\tHSG\tEA\t1\nCN-0118\tCONNECTOR 4P\tHSG\tEA\t2\nWR-0085\tWIRE AVSS 0.5SQ\tAVSS 0.5\tM\t12.5\nCL-0010\tCLIP\tBAND\tEA\t6\nOPT-TP0003\tTAPE\tPVC\tM\t1';
      var B = '품목코드\t품목명\t규격\t단위\t수량\nCN-0221\tCONNECTOR 12P\tHSG\tEA\t1\nCN-0118\tCONNECTOR 4P\tHSG\tEA\t2\nCN-0301\tCONNECTOR 2P (신규 분기)\tHSG\tEA\t1\nWR-0085\tWIRE AVSS 0.5SQ\tAVSS 0.5\tM\t14\nTP0003\tTAPE\tPVC\tM\t1';
      ['A', 'B'].forEach(function (k) {
        var t = k === 'A' ? A : B, p = L.parsePastedTable(t);
        $('#bomText' + k).value = t;
        s['bom' + k] = { label: '예시 BOM(가상)', headers: p.headers, rows: p.rows, text: t, headerRow: 1 };
        $('#bomInfo' + k).textContent = bomInfo(s['bom' + k]);
      });
      s.bomKey = '품목코드'; s.bomCols = null; fillKeySel(s);
      runBom(s);
    });
    $('#bomXlsx', main).addEventListener('click', function () {
      if (!s.bomRes) return;
      App.downloadXlsx('BOM비교_' + safe(s.partA || 'A') + '_vs_' + safe(s.partB || 'B'), [{ name: 'BOM비교', rows: bomSheetRows(s) }]);
    });
  }
  function bomSheetRows(s) {
    var rows = L.sheetTableDiff(s.bomRes, s.bomKey);
    if (s.bomRes.reps && s.bomRes.reps.length) {
      rows.push([]); rows.push(['대체 후보 (삭제 품번 → 추가 품번)', '', '근거']);
      s.bomRes.reps.forEach(function (p) { rows.push([p.from.key + ' → ' + p.to.key, '', p.reason]); });
    }
    return rows;
  }
  function diffTable(res, keyLabel) {
    var c = res.counts;
    var h = '<p class="small" style="margin-top:10px"><span class="badge b-danger">추가 ' + c.추가 + '</span> <span class="badge b-warn">변경 ' + c.변경 + '</span> <span class="badge b-info">삭제 ' + c.삭제 + '</span> <span class="badge b-muted">동일 ' + c.동일 + '</span></p>';
    if (res.reps && res.reps.length) {
      h += '<div class="warn-box small"><strong>대체 후보 ' + res.reps.length + '건</strong> — 삭제된 품번과 추가된 품번이 비슷합니다. 품번 표기만 바뀐 것인지 확인해 주세요: ' +
        res.reps.map(function (p) { return esc(p.from.key + ' → ' + p.to.key) + ' (' + esc(p.reason) + ')'; }).join(' · ') + '</div>';
    }
    h += '<div class="table-wrap"><table class="tbl diff-tbl"><thead><tr><th>상태</th><th>' + esc(keyLabel) + '</th>' + res.cols.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    res.rows.forEach(function (r) {
      var cls = { 추가: 'row-add', 삭제: 'row-del', 변경: 'row-chg', 동일: '' }[r.status];
      h += '<tr class="' + cls + '"><td>' + esc(r.status) + '</td><td>' + esc(r.key) + '</td>' + res.cols.map(function (col) {
        if (r.status === '추가') return '<td>' + esc(r.b[col]) + '</td>';
        if (r.status === '삭제') return '<td>' + esc(r.a[col]) + '</td>';
        if (r.changed.indexOf(col) >= 0) return '<td class="cell-chg"><span class="old">' + esc(r.a[col]) + '</span> → <strong>' + esc(r.b[col]) + '</strong></td>';
        return '<td>' + esc(r.b[col]) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function renderBom(s) {
    var dd = $('#drwDiff');
    if (dd) {
      var a = L.findBy(App.db.drawings, s.drwA), b = L.findBy(App.db.drawings, s.drwB);
      dd.innerHTML = a && b ? diffTable(L.tableDiff(L.drawingPartRows(a), L.drawingPartRows(b), { key: L.partRowKey, cols: ['값'] }), '구분 · 항목') : '';
    }
    var bd = $('#bomDiff');
    if (bd) bd.innerHTML = s.bomRes ? diffTable(s.bomRes, s.bomKey) : '';
  }

  // ── 6 ECN 양식으로 내보내기 ───────────────────
  function ecnCard(s, db) {
    return '<div class="card" id="ecnOut"><h2>6 ECN 양식(설계변경통보서)으로 내보내기</h2>' +
      '<p class="small">설계변경통보서 엑셀을 만들고 <strong>9절(변경 전 / 변경 후)에 A · B 비교 그림</strong>을 넣습니다. 도면 비교 결과 전체 그림과 선·글자 차이 목록, BOM 비교표는 다음 시트에 함께 담습니다.</p>' +
      '<div class="form-grid"><label class="field"><span>ECN</span><select id="ecnSel"><option value="">— ECN 없이 새 통보서 (품번만 채움) —</option>' +
      db.ecns.map(function (e) { return '<option value="' + esc(e.id) + '"' + (s.ecnId === e.id ? ' selected' : '') + '>' + esc(e.ecnNo + ' · ' + (e.partNoBefore || '') + ' → ' + (e.partNoAfter || '')) + '</option>'; }).join('') +
      '</select></label></div>' +
      '<div class="actions" style="margin-top:10px"><button type="button" class="btn btn-primary" id="ecnXlsx">설계변경통보서 (엑셀) 내려받기</button>' +
      '<button type="button" class="btn" id="toEcnMat"' + (s.bomRes && s.ecnId ? '' : ' disabled') + '>BOM 차이를 이 ECN 변경자재로 넣기</button></div>' +
      '<p class="small muted">도면이 크면 9절 그림 안에서 차이가 작게 보일 수 있습니다. 그때는 「9_도면비교」 시트의 큰 그림과 차이 목록을 봐 주세요. BOM 차이를 변경자재로 넣으면 신규·삭제·대체·수량변경·사양변경으로 나눠 5절에 들어갑니다(재고 처리·담당 부서는 ECN 화면에서 채워 주세요).</p></div>';
  }
  function wireEcn(main, s) {
    $('#ecnSel', main).addEventListener('change', function () { s.ecnId = this.value; var b = $('#toEcnMat', main); if (b) b.disabled = !(s.bomRes && s.ecnId); });
    $('#ecnXlsx', main).addEventListener('click', function () {
      var e = L.findBy(App.db.ecns, s.ecnId);
      if (!e) { e = L.emptyEcn(); e.ecnNo = 'ECN미정'; e.partNoBefore = s.partA; e.partNoAfter = s.partB; }
      App.exportEcnXlsx(e);
    });
    $('#toEcnMat', main).addEventListener('click', function () {
      var e = L.findBy(App.db.ecns, s.ecnId);
      if (!e || !s.bomRes) return;
      var mats = L.materialsFromDiff(s.bomRes, { qty: pick(s, ['수량', 'QTY']), unit: pick(s, ['단위', 'UNIT']), name: pick(s, ['품목명', '품명']), spec: pick(s, ['규격', 'SPEC']) });
      if (!mats.length) { App.toast('넣을 변경자재가 없습니다(차이 없음).'); return; }
      if (!confirm(e.ecnNo + ' 에 변경자재 ' + mats.length + '행을 추가할까요? (이미 있는 행은 그대로 둡니다)')) return;
      e.materials = L.filledMaterials(e.materials || []).concat(mats);
      App.save();
      App.toast(e.ecnNo + ' 에 변경자재 ' + mats.length + '행을 넣었습니다.');
    });
  }
  function pick(s, names) {
    var hs = commonHeaders(s);
    for (var i = 0; i < names.length; i++) for (var j = 0; j < hs.length; j++) if (L.norm(hs[j]) === L.norm(names[i])) return hs[j];
    return names[0];
  }
  function canvasBytes(c) {
    var d = c.toDataURL('image/png'), b = atob(d.split(',')[1]), u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  // ECN 화면에서도 부릅니다: 도면 비교 결과가 이 창에 있으면 9절에 그림을 넣고, 없으면 글만 담습니다.
  App.exportEcnXlsx = function (e) {
    if (!App.xlsxReady()) return;
    var X = root.XLSX, s = App.ui.cmp, db = App.db, today = App.today();
    var has = !!(s && s.res && s.A && s.B);
    var fig = null, figOpt = null;
    if (has) {
      fig = resultImage(s, 'side', 1240);
      figOpt = { heightPx: fig.height, caption: '[도면 비교] A ' + (s.partA || s.A.name) + ' (변경 전) / B ' + (s.partB || s.B.name) + ' (변경 후) — 적색 = B에만, 파랑 = A에만. ' + resText(s.res) };
    }
    var r = L.ecnReport(e, today, { figure: figOpt });
    var wb = X.utils.book_new();
    var ws = X.utils.aoa_to_sheet(r.rows);
    ws['!merges'] = r.merges.map(function (m) { return X.utils.decode_range(m); });
    ws['!cols'] = r.widths.map(function (w) { return { wch: w }; });
    if (r.rowsHpx && r.rowsHpx.length) ws['!rows'] = r.rowsHpx.map(function (v) { return v ? { hpx: v } : null; });
    X.utils.book_append_sheet(wb, ws, '설계변경통보서');
    var images = [];
    if (has) {
      images.push({ sheet: 1, png: canvasBytes(fig), col: 0, row: r.figure.row, width: fig.width, height: fig.height, name: '9절 도면 비교 (A 변경 전 · B 변경 후)' });
      var big = resultImage(s, 'overlay', 1600);
      var head = [['도면 비교 — A ' + (s.partA || s.A.name) + ' vs B ' + (s.partB || s.B.name)], [resText(s.res)], [s.res.alignText], ['아래 그림: 겹쳐 보기(적색 = B에만, 파랑 = A에만). 그림 아래에 선 차이 · 글자 차이 목록이 있습니다.']];
      var figRows = Math.ceil(big.height / 20) + 1;
      var aoa = head.slice();
      for (var i = 0; i < figRows; i++) aoa.push([]);
      aoa.push(['선 차이 목록']); regionRows(s).slice(1).forEach(function (x) { aoa.push(x); });
      if (s.res.text) { aoa.push([]); aoa.push(['글자 차이 목록']); textRows(s).forEach(function (x) { aoa.push(x); }); }
      var ws2 = X.utils.aoa_to_sheet(aoa);
      ws2['!cols'] = [10, 14, 22, 22, 10, 10, 12].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, ws2, '9_도면비교');
      images.push({ sheet: 2, png: canvasBytes(big), col: 0, row: head.length, width: big.width, height: big.height, name: '도면 비교 겹쳐 보기' });
    }
    if (s && s.bomRes) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(bomSheetRows(s)), 'BOM비교');
    if (e.id && L.findBy(db.ecns, e.id)) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(L.sheetMaterials(db, e.id)), '6_변경자재목록');
    var bytes = X.write(wb, { type: 'array', bookType: 'xlsx' });
    if (images.length) bytes = root.HNXlsxImage.addImages(X, new Uint8Array(bytes), images);
    var name = App.fileName('설계변경통보서_' + String(e.ecnNo || e.id || '미정').replace(/[\\/:*?"<>|()]/g, '_') + (has ? '_도면비교' : ''));
    if (s && s.sample && !/^예시데이터_/.test(name)) name = '예시데이터_' + name;
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    App.toast(has ? '9절에 도면 비교 그림을 넣은 통보서를 내려받았습니다.' : '통보서를 내려받았습니다. 9절 그림은 「도면 비교」에서 비교한 뒤 내보내면 들어갑니다.');
  };

  // ── 예시 도면 (가상 하네스 도식 두 장을 직접 그립니다) ─────────
  var SW = 1400, SH = 900;
  function harness(ctx, v) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SW, SH);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = 3; ctx.strokeRect(40, 40, SW - 80, SH - 80);            // 도면 테두리
    ctx.lineWidth = 2; ctx.strokeRect(960, 700, 400, 160);                  // 표제란
    ctx.beginPath(); ctx.moveTo(960, 740); ctx.lineTo(1360, 740); ctx.moveTo(960, 780); ctx.lineTo(1360, 780); ctx.moveTo(960, 820); ctx.lineTo(1360, 820); ctx.stroke();
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('PART NO. ' + (v ? 'HN-A0250' : 'HN-A0231'), 975, 728);
    ctx.fillText('REV ' + (v ? 'A' : 'C'), 1250, 728);
    ctx.font = '18px sans-serif';
    ctx.fillText('TITLE  HARNESS ASSY-MAIN', 975, 768);
    ctx.fillText('MODEL X1 · CUST. A', 975, 808);
    ctx.fillText('예시 도면(가상) — 실제 도면 아님', 975, 848);
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(180, 360); ctx.lineTo(1150, 360); ctx.stroke();
    ctx.lineWidth = 5;
    var br = [[330, 360, 330, 180], [560, 360, 560, 560], [820, 360, 820, 180], [1000, 360, 1000, 560]];
    if (v) br.push([690, 360, 690, 560]);                                    // B: 분기 추가
    br.forEach(function (b) { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[2], b[3]); ctx.stroke(); });
    var cn = [[120, 330, 'CN-0221'], [290, 130, 'CN-0118'], [520, 560, 'CN-0140'], [780, 130, 'CN-0205'], [960, 560, 'CN-0118'], [1150, 330, 'CN-0330']];
    if (v) cn.push([650, 560, 'CN-0301']);
    ctx.lineWidth = 3; ctx.font = 'bold 18px sans-serif';
    cn.forEach(function (c) {
      ctx.strokeRect(c[0], c[1], 80, 60);
      ctx.beginPath(); ctx.moveTo(c[0] + 20, c[1] + 15); ctx.lineTo(c[0] + 20, c[1] + 45); ctx.moveTo(c[0] + 40, c[1] + 15); ctx.lineTo(c[0] + 40, c[1] + 45); ctx.moveTo(c[0] + 60, c[1] + 15); ctx.lineTo(c[0] + 60, c[1] + 45); ctx.stroke();
      ctx.fillText(c[2], c[0] - 2, c[1] + (c[1] > 400 ? 88 : -12));
    });
    var clips = [250, 450, 900, 1080];
    if (!v) clips.push(700);
    ctx.lineWidth = 3;
    clips.forEach(function (x) { ctx.beginPath(); ctx.arc(x, 360, 14, 0, Math.PI * 2); ctx.stroke(); });
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(180, 440); ctx.lineTo(560, 440); ctx.moveTo(180, 425); ctx.lineTo(180, 455); ctx.moveTo(560, 425); ctx.lineTo(560, 455); ctx.stroke();
    ctx.font = '20px sans-serif'; ctx.fillText(v ? 'L=480' : 'L=450', 340, 432);
    ctx.beginPath(); ctx.moveTo(820, 260); ctx.lineTo(1000, 260); ctx.stroke();
    ctx.fillText('L=210', 880, 252);
    ctx.font = '18px sans-serif';
    ctx.fillText('NOTE 1. 테이핑 50% 겹침', 80, 700);
    ctx.fillText(v ? 'NOTE 2. CN-0301 분기 추가 (ECN 예시)' : 'NOTE 2. -', 80, 730);
  }
  // 예시 글자 목록(PDF 글자 정보 흉내) — 글자 비교도 체험할 수 있게 그린 글자와 같은 값·위치로 둡니다
  function sampleText(v) {
    var t = [['PART NO. ' + (v ? 'HN-A0250' : 'HN-A0231'), 1085, 721, 20], ['REV ' + (v ? 'A' : 'C'), 1275, 721, 20], [v ? 'L=480' : 'L=450', 368, 425, 20], ['L=210', 908, 245, 20],
      ['CN-0221', 150, 312, 18], ['CN-0118', 320, 112, 18], ['CN-0140', 550, 642, 18], ['CN-0205', 810, 112, 18], ['CN-0118', 990, 642, 18], ['CN-0330', 1180, 312, 18]];
    if (v) t.push(['CN-0301', 680, 642, 18]);
    return t.map(function (x) { return { str: x[0], x: x[1], y: x[2], h: x[3], w: x[0].length * x[3] * 0.55, ang: 0 }; });
  }
  // B 는 스캔처럼 조금 돌아가고(0.8°) 줄고(0.96배) 밀린 상태로 만듭니다 → 기준점으로 맞추는 과정을 체험
  var SAMPLE_M = { a: 0.96 * Math.cos(0.8 * Math.PI / 180), b: 0.96 * Math.sin(0.8 * Math.PI / 180), tx: 34, ty: 18 };
  function loadSample(s) {
    function mk(v, M) {
      var raw = document.createElement('canvas'); raw.width = SW; raw.height = SH;
      harness(raw.getContext('2d'), v);
      var text = sampleText(v);
      if (!M) return { canvas: raw, w: SW, h: SH, name: '예시_HN-A0231_C.png', kind: 'pdf', text: text };
      var c = document.createElement('canvas'); c.width = SW; c.height = SH;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SW, SH);
      ctx.setTransform(M.a, M.b, -M.b, M.a, M.tx, M.ty);
      ctx.drawImage(raw, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      var tt = text.map(function (x) { var p = L.applySimilarity(M, x); return { str: x.str, x: p.x, y: p.y, h: x.h * 0.96, w: x.w * 0.96, ang: 0 }; });
      return { canvas: c, w: SW, h: SH, name: '예시_HN-A0250_A_스캔.png', kind: 'pdf', text: tt };
    }
    s.A = mk(false); s.B = mk(true, SAMPLE_M);
    s.partA = 'HN-A0231'; s.partB = 'HN-A0250'; s.sample = true;
    // 기준점 3쌍: 도면 테두리 왼쪽 위 · 오른쪽 아래, 표제란 왼쪽 위 (B 좌표는 스캔 변환을 적용한 값)
    var P = [{ x: 40, y: 40 }, { x: SW - 40, y: SH - 40 }, { x: 960, y: 700 }];
    s.ptsA = P.map(function (p) { return { x: p.x, y: p.y }; });
    s.ptsB = P.map(function (p) { return L.applySimilarity(SAMPLE_M, p); });
    s.picking = false; s.view = 'side';
    var db = App.db, fa = db.drawings.filter(function (d) { return d.partNo === 'HN-A0231'; })[0], fb = db.drawings.filter(function (d) { return d.partNo === 'HN-A0250'; })[0];
    if (fa && fb) { s.drwA = fa.id; s.drwB = fb.id; }
    App.toast('예시 도면 두 장을 불러왔습니다. 기준점 3쌍은 미리 찍어 두었습니다.');
    compute(s);
  }
})(window);
