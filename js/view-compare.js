/* 도면 비교 — A품번(기준)과 B품번(비교 대상) 도면을 겹쳐 B의 차이를 적색으로 표시 (2026-09-29 수강생 추가 요청)
   도면 그림은 이 창의 메모리(canvas)에서만 다룹니다. 서버로 보내지 않고 localStorage 에도 넣지 않습니다.
   계산(이진화·팽창·차이·연결요소·유사변환)은 logic.js 순수 함수입니다. */
(function (root) {
  'use strict';
  var App = root.HNApp, L = App.L, esc = App.esc, $ = App.$, $$ = App.$$;
  var MAX_SIDE = 1800;   // 긴 변을 이 크기까지 줄여 계산합니다(속도·메모리)
  var COL = { add: [214, 32, 32], del: [37, 99, 235], ink: [34, 40, 49], faint: [178, 184, 192] };

  function st() {
    if (!App.ui.cmp) {
      App.ui.cmp = {
        A: null, B: null, partA: '', partB: '', ptsA: [], ptsB: [], picking: false,
        opt: { thr: 160, tol: 1, minArea: 10, gap: 8, fade: true },
        view: 'overlay', split: 50, res: null, sel: 0,
        drwA: '', drwB: '', bomA: null, bomB: null, bomKey: '', bomRes: null
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
      '<button type="button" class="btn btn-primary" id="cmpSave"' + (s.res ? '' : ' disabled') + '>결과 PNG 저장</button>' +
      '<button type="button" class="btn btn-ghost" id="cmpClear">모두 비우기</button></div></div>' +
      '<div class="ok-box cmp-privacy"><strong>도면은 이 브라우저 안에서만 처리합니다.</strong> 불러온 도면 그림은 어디에도 업로드하지 않고, 저장소(localStorage)에도 남기지 않습니다. ' +
      '비교 계산도 모두 이 PC 에서 합니다 — 인터넷이 끊겨 있어도 됩니다. 창을 닫으면 그림은 사라집니다.</div>' +
      '<p class="principle">A품번(기준) 도면과 B품번(비교 대상) 도면을 겹쳐, A와 비교해 B에서 달라진 선을 적색으로 표시합니다. 표시는 후보일 뿐이니 최종 판단은 도면을 직접 보고 해 주세요.</p>' +
      partList;

    // 1 불러오기
    h += '<div class="card"><h2>1 도면 불러오기</h2><div class="cmp-two">' + slot('A', s) + slot('B', s) + '</div>' +
      '<p class="small muted">PNG · JPG 그림이나 PDF 를 올려 주세요. PDF 는 지정한 쪽(기본 1쪽)을 그림으로 바꿔 비교합니다. 그림이 너무 크면 긴 변 ' + MAX_SIDE + '픽셀로 줄여 계산합니다. ' +
      'PDF 가 열리지 않으면 PDF 뷰어에서 해당 쪽을 PNG 로 저장해 올려 주세요.</p></div>';

    // 2 위치 맞추기
    var T = transform(s);
    h += '<div class="card"><h2>2 위치 맞추기</h2>' +
      '<p class="small">B 도면은 먼저 A 도면 가로 폭에 맞춰 크기만 맞춥니다. 스캔이 비뚤거나 여백이 다르면 <strong>「기준점 찍기」</strong>를 누르고, 두 도면에서 같은 곳(도면 테두리 모서리, 표제란 모서리 등)을 A → B 순서로 번갈아 2~3쌍 찍어 주세요. 이동·회전·배율을 한꺼번에 맞춥니다.</p>' +
      '<div class="actions"><button type="button" class="btn' + (s.picking ? ' btn-primary' : '') + '" id="pickBtn"' + (s.A && s.B ? '' : ' disabled') + '>' + (s.picking ? '기준점 찍는 중 — 끝내기' : '기준점 찍기') + '</button>' +
      '<button type="button" class="btn btn-sm" id="pickUndo"' + (s.ptsA.length ? '' : ' disabled') + '>마지막 점 지우기</button>' +
      '<button type="button" class="btn btn-sm" id="pickClear"' + (s.ptsA.length ? '' : ' disabled') + '>기준점 모두 지우기</button></div>' +
      '<p class="small" id="alignInfo">' + esc(alignText(s, T)) + '</p>' +
      (s.A && s.B ? '<div class="cmp-two"><div><div class="small"><strong>A</strong> ' + esc(s.partA || s.A.name) + '</div><canvas class="cmp-canvas pickable" id="pickA"></canvas></div>' +
        '<div><div class="small"><strong>B</strong> ' + esc(s.partB || s.B.name) + '</div><canvas class="cmp-canvas pickable" id="pickB"></canvas></div></div>' : '<p class="muted small">두 도면을 모두 불러오면 여기에 나란히 보입니다.</p>') +
      '</div>';

    // 3 차이 계산
    var o = s.opt;
    h += '<div class="card"><h2>3 차이 계산</h2><div class="form-grid">' +
      rng('thr', '선으로 볼 어둡기', 60, 240, 5, o.thr, '클수록 흐린 선도 선으로 봅니다') +
      rng('tol', '흔들림 허용 (픽셀)', 0, 6, 1, o.tol, '이만큼 안에서 어긋난 선은 같은 선으로 봅니다 — 스캔본은 2~3') +
      rng('minArea', '최소 면적 (픽셀)', 1, 200, 1, o.minArea, '이보다 작은 점 잡음은 버립니다') +
      rng('gap', '묶음 거리 (픽셀)', 0, 40, 1, o.gap, '이만큼 가까운 조각은 한 상자로 묶습니다') +
      '</div><label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="optFade"' + (o.fade ? ' checked' : '') + '> 공통 선은 흐리게 보기</label>' +
      '<div class="actions" style="margin-top:10px"><button type="button" class="btn btn-primary" id="runDiff"' + (s.A && s.B ? '' : ' disabled') + '>차이 계산</button>' +
      '<span class="small muted" id="diffInfo">' + (s.res ? esc(resText(s.res)) : '') + '</span></div></div>';

    // 4 결과
    h += '<div class="card"><div class="page-head"><h2 style="margin:0">4 결과</h2><div class="seg" role="tablist">' +
      [['overlay', '오버레이'], ['side', '나란히'], ['slider', '슬라이더']].map(function (v) {
        return '<button type="button" class="btn btn-sm' + (s.view === v[0] ? ' btn-primary' : '') + '" data-view="' + v[0] + '" aria-pressed="' + (s.view === v[0]) + '">' + v[1] + '</button>';
      }).join('') + '</div></div>' +
      '<ul class="legend"><li><span class="sw sw-add"></span>적색 — B에만 있는 선 (A와 비교해 추가·변경된 곳)</li>' +
      '<li><span class="sw sw-del"></span>파랑 — A에만 있는 선 (B에서 사라진 곳)</li><li><span class="sw sw-ink"></span>회색 — 두 도면 공통</li></ul>' +
      '<div id="resultBox">' + (s.res ? '' : '<p class="muted small">「차이 계산」을 누르면 결과가 여기에 나옵니다. 먼저 보고 싶으면 위의 「예시 불러오기」를 눌러 보세요.</p>') + '</div>' +
      (s.view === 'slider' && s.res ? '<label class="small" style="display:block;margin-top:8px">왼쪽 A ↔ 오른쪽 B 경계 <input type="range" id="splitR" min="0" max="100" value="' + s.split + '" style="width:100%"></label>' : '') +
      '<div id="regionBox"></div></div>';

    // 5 부품 표 비교
    h += bomCard(s, db);
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
    return '<div class="cmp-slot"><h3>' + (k === 'A' ? 'A품번 — 기준 도면' : 'B품번 — 비교 대상 도면') + '</h3>' +
      '<label class="field"><span>' + k + '품번</span><input type="text" list="partNos" id="part' + k + '" value="' + esc(part) + '" placeholder="예: HN-A0231"></label>' +
      '<div class="form-grid" style="margin-top:8px"><label class="field wide"><span>도면 파일 (PNG · JPG · PDF)</span><input type="file" id="file' + k + '" accept="image/png,image/jpeg,.png,.jpg,.jpeg,application/pdf,.pdf"></label>' +
      '<label class="field"><span>PDF 쪽 번호</span><input type="number" id="page' + k + '" min="1" value="1"></label></div>' +
      (canPdf ? '<p class="small"><button type="button" class="btn btn-sm" data-usereg="' + k + '">등록한 PDF(' + esc(L.findBy(db.drawings, drwId).fileName || drwId) + ') 불러오기</button></p>' : '') +
      '<p class="small ' + (img ? '' : 'muted') + '" id="info' + k + '">' + (img ? esc(img.name + ' · ' + img.w + '×' + img.h + '픽셀') : '아직 불러오지 않았습니다.') + '</p></div>';
  }
  function rng(key, label, min, max, step, val, hint) {
    return '<label class="field"><span>' + esc(label) + ' <output id="out_' + key + '">' + val + '</output></span>' +
      '<input type="range" data-opt="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"><span class="hint">' + esc(hint) + '</span></label>';
  }
  function resText(r) {
    var add = r.regions.filter(function (x) { return x.type === '추가'; }).length;
    return '적색(B에만) ' + add + '곳 · 파랑(A에만) ' + (r.regions.length - add) + '곳 — 차이 픽셀 ' + r.diff.addedCount + ' / ' + r.diff.removedCount;
  }

  // ── 좌표 변환 ─────────────────────────────
  function baseScale(s) { return s.A && s.B ? s.A.w / s.B.w : 1; }
  function transform(s) {
    var n = Math.min(s.ptsA.length, s.ptsB.length);
    if (!s.A || !s.B) return null;
    if (!n) { var k = baseScale(s); return { a: k, b: 0, tx: 0, ty: 0, scale: k, angle: 0, rms: 0, none: true }; }
    return L.fitSimilarity(s.ptsB.slice(0, n), s.ptsA.slice(0, n), baseScale(s));
  }
  function alignText(s, T) {
    if (!T) return '두 도면을 불러오면 위치 맞추기를 할 수 있습니다.';
    var n = Math.min(s.ptsA.length, s.ptsB.length);
    var head = T.none ? '기준점 없음 — B를 A 가로 폭에 맞춰 크기만 맞췄습니다.' : '기준점 ' + n + '쌍' + (n === 1 ? '(배율 고정·이동만)' : '') + ' — ';
    if (T.none) return head + ' 배율 ' + T.scale.toFixed(3);
    var t = head + '배율 ' + T.scale.toFixed(3) + ' · 회전 ' + T.angle.toFixed(2) + '° · 이동 (' + Math.round(T.tx) + ', ' + Math.round(T.ty) + ')';
    if (n >= 3) t += ' · 점 오차 평균 ' + T.rms.toFixed(1) + '픽셀' + (T.rms > 6 ? ' — 오차가 큽니다. 점을 다시 찍어 보세요.' : '');
    if (s.ptsA.length > s.ptsB.length) t += ' · 이제 B 도면에서 ' + s.ptsA.length + '번 점을 찍어 주세요.';
    return t;
  }

  // ── 불러오기 ─────────────────────────────
  function fitCanvas(src, w, h, name) {
    var k = Math.min(1, MAX_SIDE / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return { canvas: c, w: c.width, h: c.height, name: name };
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
  function loadPdfPage(buf, pageNo, name) {
    if (!App.loadPdf) return Promise.reject(new Error('PDF 라이브러리를 불러오지 못했습니다. PNG 로 저장해 올려 주세요.'));
    return App.loadPdf(buf).then(function (pdf) {
      var p = Math.min(Math.max(1, pageNo || 1), pdf.numPages);
      return pdf.getPage(p).then(function (page) {
        var vp0 = page.getViewport({ scale: 1 });
        var vp = page.getViewport({ scale: MAX_SIDE / Math.max(vp0.width, vp0.height) });
        var c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          return { canvas: c, w: c.width, h: c.height, name: name + ' (' + p + '/' + pdf.numPages + '쪽)' };
        });
      });
    });
  }
  function loadInto(s, k, file, pageNo) {
    var isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    var p = isPdf ? file.arrayBuffer().then(function (buf) { return loadPdfPage(buf, pageNo, file.name); }) : loadImageFile(file);
    p.then(function (img) { setImage(s, k, img); App.toast(k + ' 도면을 불러왔습니다.'); })
      .catch(function (e) { App.toast(e.message || String(e)); });
  }
  function setImage(s, k, img) {
    s[k] = img; s.ptsA = []; s.ptsB = []; s.res = null; s.picking = false; s.sel = 0;
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
        loadPdfPage(App.files[id].slice(0), +$('#page' + k, main).value || 1, d.fileName || d.partNo)
          .then(function (img) { setImage(s, k, img); }).catch(function (e) { App.toast(e.message); });
      });
    });
    $('#cmpSample', main).addEventListener('click', function () { loadSample(s); });
    $('#cmpClear', main).addEventListener('click', function () { App.ui.cmp = null; App.go('#/compare'); });
    $('#cmpSave', main).addEventListener('click', function () { savePng(s); });
    var pb = $('#pickBtn', main);
    pb.addEventListener('click', function () { s.picking = !s.picking; App.rerender(); });
    $('#pickUndo', main).addEventListener('click', function () {
      if (s.ptsA.length > s.ptsB.length) s.ptsA.pop(); else { s.ptsB.pop(); s.ptsA.pop(); }
      s.res = null; App.rerender();
    });
    $('#pickClear', main).addEventListener('click', function () { s.ptsA = []; s.ptsB = []; s.res = null; App.rerender(); });
    ['A', 'B'].forEach(function (k) {
      var c = $('#pick' + k, main);
      if (c) c.addEventListener('click', function (ev) { pickPoint(s, k, c, ev); });
    });
    $$('[data-opt]', main).forEach(function (r) {
      r.addEventListener('input', function () { $('#out_' + r.getAttribute('data-opt'), main).textContent = r.value; });
      r.addEventListener('change', function () { s.opt[r.getAttribute('data-opt')] = +r.value; if (s.res) compute(s); });
    });
    $('#optFade', main).addEventListener('change', function () { s.opt.fade = this.checked; if (s.res) renderResult(s); });
    $('#runDiff', main).addEventListener('click', function () { compute(s); });
    $$('[data-view]', main).forEach(function (b) {
      b.addEventListener('click', function () { s.view = b.getAttribute('data-view'); App.rerender(); });
    });
    var sr = $('#splitR', main);
    if (sr) sr.addEventListener('input', function () { s.split = +sr.value; renderResult(s); });
    wireBom(main, s);
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
      c.width = img.w; c.height = img.h;
      var ctx = c.getContext('2d');
      ctx.drawImage(img.canvas, 0, 0);
      var pts = k === 'A' ? s.ptsA : s.ptsB, rad = Math.max(8, img.w / 90);
      pts.forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234,120,0,.25)'; ctx.fill();
        ctx.lineWidth = Math.max(2, rad / 4); ctx.strokeStyle = '#c05f00'; ctx.stroke();
        ctx.font = 'bold ' + Math.round(rad * 1.6) + 'px sans-serif'; ctx.fillStyle = '#c05f00';
        ctx.fillText(String(i + 1), p.x + rad + 3, p.y - rad);
      });
    });
  }

  // ── 계산 ────────────────────────────────
  function compute(s) {
    if (!s.A || !s.B) return;
    var T = transform(s), W = s.A.w, H = s.A.h;
    var cb = document.createElement('canvas'); cb.width = W; cb.height = H;
    var ctx = cb.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    // canvas setTransform(a, b, c, d, e, f): x' = a·x + c·y + e, y' = b·x + d·y + f
    ctx.setTransform(T.a, T.b, -T.b, T.a, T.tx, T.ty);
    ctx.drawImage(s.B.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var da = s.A.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    var dbb = ctx.getImageData(0, 0, W, H).data;
    var mA = L.binarize(da, W, H, s.opt.thr), mB = L.binarize(dbb, W, H, s.opt.thr);
    var diff = L.diffMasks(mA, mB, W, H, s.opt.tol);
    var regions = L.diffRegions(diff, W, H, { minArea: s.opt.minArea, gap: s.opt.gap });
    s.res = { W: W, H: H, mA: mA, mB: mB, diff: diff, regions: regions, T: T, at: new Date() };
    s.sel = 0;
    App.rerender();
  }

  // 마스크 → 그림. which: 'overlay' | 'A' | 'B'
  function paint(s, which) {
    var r = s.res, W = r.W, H = r.H, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d'), im = ctx.createImageData(W, H), d = im.data;
    var ink = s.opt.fade ? COL.faint : COL.ink;
    for (var i = 0; i < W * H; i++) {
      var col = null, a = r.mA[i], b = r.mB[i];
      if (which === 'overlay') {
        if (r.diff.added[i]) col = COL.add; else if (r.diff.removed[i]) col = COL.del; else if (a || b) col = ink;
      } else if (which === 'B') {
        if (r.diff.added[i]) col = COL.add; else if (b) col = ink; else if (r.diff.removed[i]) col = [196, 214, 250];
      } else {
        if (r.diff.removed[i]) col = COL.del; else if (a) col = ink;
      }
      var p = i * 4;
      if (col) { d[p] = col[0]; d[p + 1] = col[1]; d[p + 2] = col[2]; } else { d[p] = d[p + 1] = d[p + 2] = 255; }
      d[p + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    drawBoxes(ctx, s, which);
    return c;
  }
  function drawBoxes(ctx, s, which) {
    var W = s.res.W, pad = Math.max(4, Math.round(W / 250)), lw = Math.max(2, Math.round(W / 700));
    var fs = Math.max(12, Math.round(W / 80));
    ctx.font = 'bold ' + fs + 'px sans-serif';
    s.res.regions.forEach(function (g) {
      if (which === 'A' && g.type === '추가') return;
      var col = g.type === '추가' ? 'rgb(214,32,32)' : 'rgb(37,99,235)';
      var on = s.sel === g.no;
      ctx.lineWidth = on ? lw * 2.5 : lw;
      ctx.strokeStyle = col;
      ctx.setLineDash(g.type === '삭제' ? [lw * 3, lw * 2] : []);
      ctx.strokeRect(g.x - pad, g.y - pad, g.w + pad * 2, g.h + pad * 2);
      ctx.setLineDash([]);
      var label = String(g.no), tw = ctx.measureText(label).width + 8;
      var ly = Math.max(0, g.y - pad - fs - 4);
      ctx.fillStyle = col; ctx.fillRect(g.x - pad, ly, tw, fs + 4);
      ctx.fillStyle = '#fff'; ctx.fillText(label, g.x - pad + 4, ly + fs);
    });
  }

  function renderResult(s) {
    var box = $('#resultBox'); if (!box || !s.res) return;
    box.innerHTML = '';
    if (s.view === 'side') {
      var g = document.createElement('div'); g.className = 'cmp-two';
      [['A', 'A ' + (s.partA || s.A.name) + ' — 파랑 = B에서 사라진 선'], ['B', 'B ' + (s.partB || s.B.name) + ' — 적색 = A와 달라진 선']].forEach(function (x) {
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
  function renderRegions(s) {
    var box = $('#regionBox'); if (!box) return;
    var r = s.res;
    if (!r.regions.length) { box.innerHTML = '<div class="ok-box" style="margin-top:12px">지금 설정으로는 차이 영역이 없습니다. 흔들림 허용을 줄이거나 최소 면적을 낮춰 다시 계산해 볼 수 있습니다.</div>'; return; }
    box.innerHTML = '<h3 style="margin-top:14px">차이 영역 ' + r.regions.length + '곳</h3><p class="small muted">줄을 누르면 그림에서 해당 상자를 굵게 표시합니다. 좌표는 A 도면 기준 픽셀(왼쪽 위가 0, 0)입니다.</p>' +
      App.table([
        { label: '번호', render: function (g) { return '<strong>' + g.no + '</strong>'; } },
        { label: '구분', render: function (g) { return g.type === '추가' ? '<span class="badge b-danger">B에만 (적색)</span>' : '<span class="badge b-info">A에만 (파랑)</span>'; } },
        { label: '위치 (x, y)', render: function (g) { return g.x + ', ' + g.y; } },
        { label: '크기 (가로×세로)', render: function (g) { return g.w + '×' + g.h; } },
        { label: '면적 (선 픽셀)', key: 'area', cls: 'num' }
      ], r.regions, { rowAttr: function (g) { return 'data-reg="' + g.no + '" class="clickable' + (s.sel === g.no ? ' sel' : '') + '"'; } }) +
      '<div class="actions" style="margin-top:8px"><button type="button" class="btn btn-sm" id="regXlsx">차이 영역 목록 (엑셀)</button></div>';
    $$('[data-reg]', box).forEach(function (tr) {
      tr.addEventListener('click', function () { var n = +tr.getAttribute('data-reg'); s.sel = s.sel === n ? 0 : n; renderResult(s); });
    });
    $('#regXlsx', box).addEventListener('click', function () {
      var rows = [['A품번', s.partA, 'B품번', s.partB], ['번호', '구분', 'x', 'y', '가로', '세로', '면적(픽셀)']];
      r.regions.forEach(function (g) { rows.push([g.no, g.type === '추가' ? 'B에만(적색)' : 'A에만(파랑)', g.x, g.y, g.w, g.h, g.area]); });
      App.downloadXlsx('도면비교_차이영역', [{ name: '차이영역', rows: rows }]);
    });
  }

  // 저장용 그림: 위에 품번·범례 띠를 붙입니다
  function savePng(s) {
    if (!s.res) return;
    var body;
    if (s.view === 'side') {
      var a = paint(s, 'A'), b = paint(s, 'B'), gap = 24;
      body = document.createElement('canvas'); body.width = a.width + b.width + gap; body.height = Math.max(a.height, b.height);
      var bx = body.getContext('2d'); bx.fillStyle = '#fff'; bx.fillRect(0, 0, body.width, body.height);
      bx.drawImage(a, 0, 0); bx.drawImage(b, a.width + gap, 0);
    } else body = s.view === 'slider' ? sliderCanvas(s) : paint(s, 'overlay');
    var head = 64, c = document.createElement('canvas');
    c.width = body.width; c.height = body.height + head;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(body, 0, head);
    ctx.fillStyle = '#1a2330'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText('도면 비교 — A ' + (s.partA || s.A.name) + '  vs  B ' + (s.partB || s.B.name), 12, 28);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = 'rgb(214,32,32)'; ctx.fillText('적색 = B에만 있는 선', 12, 54);
    ctx.fillStyle = 'rgb(37,99,235)'; ctx.fillText('파랑 = A에만 있는 선', 200, 54);
    ctx.fillStyle = '#566170'; ctx.fillText('차이 ' + s.res.regions.length + '곳 · ' + L.toDateTimeStr(new Date()) + ' · 자동 표시는 후보이며 최종 판단은 담당자', 390, 54);
    c.toBlob(function (blob) {
      var name = '도면비교_' + safe(s.partA || 'A') + '_vs_' + safe(s.partB || 'B') + '_' + L.toDateStr(new Date()).replace(/-/g, '') + '.png';
      if (App.db._sample || s.sample) name = '예시데이터_' + name;
      var aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(blob); aEl.download = name;
      document.body.appendChild(aEl); aEl.click();
      setTimeout(function () { URL.revokeObjectURL(aEl.href); aEl.remove(); }, 1000);
    }, 'image/png');
  }
  function safe(x) { return String(x).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40); }

  // ── 5 부품 표 비교 ─────────────────────────
  function bomCard(s, db) {
    var opts = function (sel) {
      return '<option value="">— 고르기 —</option>' + db.drawings.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (sel === d.id ? ' selected' : '') + '>' + esc(App.drawingLabel(d) + ' (' + d.id + ')') + '</option>';
      }).join('');
    };
    var h = '<div class="card"><h2>5 부품 표 비교</h2>' +
      '<p class="small">그림 비교와 함께, A품번·B품번의 부품 표를 줄 단위로 맞대어 봅니다. <span class="t-add">적색 = B에서 추가·변경</span> · <span class="t-del">파랑 취소선 = B에서 삭제</span>.</p>' +
      '<h3>등록한 도면 정보로 비교</h3>' +
      (db.drawings.length ? '<div class="form-grid"><label class="field"><span>A 도면</span><select id="drwA">' + opts(s.drwA) + '</select></label>' +
        '<label class="field"><span>B 도면</span><select id="drwB">' + opts(s.drwB) + '</select></label></div>' +
        '<p class="small muted">도면 정보(품명·REV·고객사·기종·사용처·회로 수·분기 수)와 주요 커넥터·전선·구조 키워드 목록을 비교합니다. 같은 품번이 여러 번 적혀 있으면 수량으로 셉니다.</p><div id="drwDiff"></div>'
        : '<p class="muted small">등록된 도면이 없습니다. 「도면 등록」에서 올리거나 대시보드에서 예시 데이터를 불러오면 여기서 고를 수 있습니다.</p>') +
      '<h3 style="margin-top:16px">BOM 표로 비교</h3>' +
      '<p class="small muted">BOM 엑셀(xlsx·csv)을 고르거나, 엑셀에서 머리행까지 복사해 붙여 넣어 주세요. 두 표의 열 이름이 같아야 칸별로 비교합니다. 이 표도 브라우저 안에서만 읽습니다.</p>' +
      '<div class="cmp-two">' + ['A', 'B'].map(function (k) {
        var t = s['bom' + k];
        return '<div><label class="field"><span>' + k + ' BOM 파일</span><input type="file" id="bomFile' + k + '" accept=".xlsx,.xls,.csv"></label>' +
          '<label class="field" style="margin-top:6px"><span>또는 붙여 넣기</span><textarea id="bomText' + k + '" placeholder="품번&#9;품명&#9;수량 …">' + esc(t && t.text ? t.text : '') + '</textarea></label>' +
          '<p class="small muted" id="bomInfo' + k + '">' + (t ? esc(t.label + ' · ' + t.rows.length + '행') : '') + '</p></div>';
      }).join('') + '</div>' +
      '<div class="actions"><label class="field" style="min-width:200px"><span>기준 열 (품번)</span><select id="bomKey"></select></label>' +
      '<button type="button" class="btn btn-primary" id="bomRun" style="align-self:end">표 비교</button>' +
      '<button type="button" class="btn" id="bomSample" style="align-self:end">예시 BOM 넣기</button>' +
      '<button type="button" class="btn" id="bomXlsx" style="align-self:end"' + (s.bomRes ? '' : ' disabled') + '>비교 결과 (엑셀)</button></div>' +
      '<div id="bomDiff"></div></div>';
    return h;
  }
  function headersOf(t) { return t ? t.headers : []; }
  function fillKeySel(s) {
    var sel = $('#bomKey'); if (!sel) return;
    var hs = headersOf(s.bomA).filter(function (x) { return headersOf(s.bomB).indexOf(x) >= 0; });
    if (!hs.length) hs = headersOf(s.bomA).length ? headersOf(s.bomA) : headersOf(s.bomB);
    if (!s.bomKey || hs.indexOf(s.bomKey) < 0) s.bomKey = L.guessKeyColumn(hs);
    sel.innerHTML = hs.map(function (x) { return '<option' + (x === s.bomKey ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') || '<option value="">표를 먼저 넣어 주세요</option>';
  }
  function wireBom(main, s) {
    ['A', 'B'].forEach(function (k) {
      var da = $('#drw' + k, main);
      if (da) da.addEventListener('change', function () { s['drw' + k] = this.value; var d = L.findBy(App.db.drawings, this.value); if (d) s['part' + k] = d.partNo; App.rerender(); });
      $('#bomFile' + k, main).addEventListener('change', function () {
        var f = this.files[0]; if (!f || !App.xlsxReady()) return;
        App.readTable(f).then(function (book) {
          var name = Object.keys(book).filter(function (n) { return book[n].length; })[0];
          if (!name) { App.toast('읽을 행이 없습니다.'); return; }
          var rows = book[name];
          s['bom' + k] = { label: f.name + ' · ' + name, headers: Object.keys(rows[0]), rows: rows };
          $('#bomInfo' + k).textContent = s['bom' + k].label + ' · ' + rows.length + '행';
          fillKeySel(s);
        }).catch(function (e) { App.toast('표를 읽지 못했습니다: ' + e.message); });
      });
      $('#bomText' + k, main).addEventListener('change', function () {
        var p = L.parsePastedTable(this.value);
        s['bom' + k] = p.headers.length ? { label: '붙여 넣은 표', headers: p.headers, rows: p.rows, text: this.value } : null;
        $('#bomInfo' + k).textContent = s['bom' + k] ? '붙여 넣은 표 · ' + p.rows.length + '행' : '';
        fillKeySel(s);
      });
    });
    fillKeySel(s);
    $('#bomKey', main).addEventListener('change', function () { s.bomKey = this.value; });
    $('#bomRun', main).addEventListener('click', function () {
      if (!s.bomA || !s.bomB) { App.toast('A · B 표를 모두 넣어 주세요.'); return; }
      s.bomRes = L.tableDiff(s.bomA.rows, s.bomB.rows, { key: s.bomKey });
      renderBom(s); $('#bomXlsx').disabled = false;
    });
    $('#bomSample', main).addEventListener('click', function () {
      var A = '품번\t품명\t수량\t단위\nCN-0221\tCONNECTOR 12P\t1\tEA\nCN-0118\tCONNECTOR 4P\t2\tEA\nWR-0085\tWIRE AVSS 0.5SQ\t12.5\tM\nCL-0010\tCLIP\t6\tEA\nTP-0003\tTAPE\t1\tROLL';
      var B = '품번\t품명\t수량\t단위\nCN-0221\tCONNECTOR 12P\t1\tEA\nCN-0118\tCONNECTOR 4P\t2\tEA\nCN-0301\tCONNECTOR 2P (신규 분기)\t1\tEA\nWR-0085\tWIRE AVSS 0.5SQ\t14\tM\nTP-0003\tTAPE\t1\tROLL';
      ['A', 'B'].forEach(function (k) {
        var t = k === 'A' ? A : B, p = L.parsePastedTable(t);
        $('#bomText' + k).value = t;
        s['bom' + k] = { label: '예시 BOM(가상)', headers: p.headers, rows: p.rows, text: t };
        $('#bomInfo' + k).textContent = '예시 BOM(가상) · ' + p.rows.length + '행';
      });
      s.bomKey = '품번'; fillKeySel(s);
      s.bomRes = L.tableDiff(s.bomA.rows, s.bomB.rows, { key: '품번' });
      renderBom(s); $('#bomXlsx').disabled = false;
    });
    $('#bomXlsx', main).addEventListener('click', function () {
      if (!s.bomRes) return;
      App.downloadXlsx('BOM비교_' + safe(s.partA || 'A') + '_vs_' + safe(s.partB || 'B'), [{ name: 'BOM비교', rows: L.sheetTableDiff(s.bomRes, s.bomKey) }]);
    });
  }
  function diffTable(res, keyLabel) {
    var c = res.counts;
    var h = '<p class="small"><span class="badge b-danger">추가 ' + c.추가 + '</span> <span class="badge b-warn">변경 ' + c.변경 + '</span> <span class="badge b-info">삭제 ' + c.삭제 + '</span> <span class="badge b-muted">동일 ' + c.동일 + '</span></p>' +
      '<div class="table-wrap"><table class="tbl diff-tbl"><thead><tr><th>상태</th><th>' + esc(keyLabel) + '</th>' + res.cols.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
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
    // 본선(트렁크)
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(180, 360); ctx.lineTo(1150, 360); ctx.stroke();
    // 분기선
    ctx.lineWidth = 5;
    var br = [[330, 360, 330, 180], [560, 360, 560, 560], [820, 360, 820, 180], [1000, 360, 1000, 560]];
    if (v) br.push([690, 360, 690, 560]);                                    // B: 분기 추가
    br.forEach(function (b) { ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[2], b[3]); ctx.stroke(); });
    // 커넥터(상자 + 품번)
    var cn = [[120, 330, 'CN-0221'], [290, 130, 'CN-0118'], [520, 560, 'CN-0140'], [780, 130, 'CN-0205'], [960, 560, 'CN-0118'], [1150, 330, 'CN-0330']];
    if (v) cn.push([650, 560, 'CN-0301']);
    ctx.lineWidth = 3; ctx.font = 'bold 18px sans-serif';
    cn.forEach(function (c) {
      ctx.strokeRect(c[0], c[1], 80, 60);
      ctx.beginPath(); ctx.moveTo(c[0] + 20, c[1] + 15); ctx.lineTo(c[0] + 20, c[1] + 45); ctx.moveTo(c[0] + 40, c[1] + 15); ctx.lineTo(c[0] + 40, c[1] + 45); ctx.moveTo(c[0] + 60, c[1] + 15); ctx.lineTo(c[0] + 60, c[1] + 45); ctx.stroke();
      ctx.fillText(c[2], c[0] - 2, c[1] + (c[1] > 400 ? 88 : -12));
    });
    // 클립(원) — B 에서는 가운데 하나를 뺐습니다
    var clips = [250, 450, 900, 1080];
    if (!v) clips.push(700);
    ctx.lineWidth = 3;
    clips.forEach(function (x) { ctx.beginPath(); ctx.arc(x, 360, 14, 0, Math.PI * 2); ctx.stroke(); });
    // 치수선 — B 는 길이 변경
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(180, 440); ctx.lineTo(560, 440); ctx.moveTo(180, 425); ctx.lineTo(180, 455); ctx.moveTo(560, 425); ctx.lineTo(560, 455); ctx.stroke();
    ctx.font = '20px sans-serif'; ctx.fillText(v ? 'L=480' : 'L=450', 340, 432);
    ctx.beginPath(); ctx.moveTo(820, 260); ctx.lineTo(1000, 260); ctx.stroke();
    ctx.fillText('L=210', 880, 252);
    // 메모
    ctx.font = '18px sans-serif';
    ctx.fillText('NOTE 1. 테이핑 50% 겹침', 80, 700);
    ctx.fillText(v ? 'NOTE 2. CN-0301 분기 추가 (ECN 예시)' : 'NOTE 2. -', 80, 730);
  }
  // B 는 스캔처럼 조금 돌아가고(0.8°) 줄고(0.96배) 밀린 상태로 만듭니다 → 기준점으로 맞추는 과정을 체험
  var SAMPLE_M = { a: 0.96 * Math.cos(0.8 * Math.PI / 180), b: 0.96 * Math.sin(0.8 * Math.PI / 180), tx: 34, ty: 18 };
  function loadSample(s) {
    function mk(v, M) {
      var raw = document.createElement('canvas'); raw.width = SW; raw.height = SH;
      harness(raw.getContext('2d'), v);
      if (!M) return { canvas: raw, w: SW, h: SH, name: v ? '예시_HN-A0250_A.png' : '예시_HN-A0231_C.png' };
      var c = document.createElement('canvas'); c.width = SW; c.height = SH;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SW, SH);
      ctx.setTransform(M.a, M.b, -M.b, M.a, M.tx, M.ty);
      ctx.drawImage(raw, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return { canvas: c, w: SW, h: SH, name: '예시_HN-A0250_A_스캔.png' };
    }
    s.A = mk(false); s.B = mk(true, SAMPLE_M);
    s.partA = 'HN-A0231'; s.partB = 'HN-A0250'; s.sample = true;
    // 기준점 3쌍: 도면 테두리 왼쪽 위 · 오른쪽 아래, 표제란 왼쪽 위 (B 좌표는 스캔 변환을 적용한 값)
    var P = [{ x: 40, y: 40 }, { x: SW - 40, y: SH - 40 }, { x: 960, y: 700 }];
    s.ptsA = P.map(function (p) { return { x: p.x, y: p.y }; });
    s.ptsB = P.map(function (p) { return L.applySimilarity(SAMPLE_M, p); });
    s.picking = false; s.view = 'overlay';
    var db = App.db, fa = db.drawings.filter(function (d) { return d.partNo === 'HN-A0231'; })[0], fb = db.drawings.filter(function (d) { return d.partNo === 'HN-A0250'; })[0];
    if (fa && fb) { s.drwA = fa.id; s.drwB = fb.id; }
    App.toast('예시 도면 두 장을 불러왔습니다. 기준점 3쌍은 미리 찍어 두었습니다.');
    compute(s);
  }
})(window);
