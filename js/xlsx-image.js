/* 엑셀(xlsx)에 그림 넣기 — SheetJS 커뮤니티판은 그림 쓰기를 지원하지 않아,
   SheetJS 가 만든 xlsx(zip)를 같은 라이브러리의 CFB(zip 읽기·쓰기)로 열어 그림 파일과 도면(drawing) XML 을 덧붙입니다.
   브라우저(window.XLSX)와 node(require('../vendor/xlsx.full.min.js')) 양쪽에서 씁니다. 2026-09-29 */
(function (root) {
  'use strict';
  var EMU = 9525; // 1 픽셀 = 9525 EMU (96 dpi)
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function enc(s) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Buffer.from(s, 'utf8'); }
  function dec(u) {
    if (typeof u === 'string') return u;
    return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(u) : Buffer.from(u).toString('utf8');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // images = [{sheet: 1부터 센 시트 번호, png: Uint8Array, col, row (0부터), width, height (픽셀), name}]
  function addImages(XLSX, xlsxBytes, images) {
    var CFB = XLSX.CFB;
    if (!CFB) throw new Error('엑셀 라이브러리에 CFB(zip) 기능이 없습니다.');
    var zip = CFB.read(xlsxBytes, { type: 'array' });
    function get(path) { var f = CFB.find(zip, path); return f ? dec(f.content) : null; }
    function put(path, text) {
      var f = CFB.find(zip, path);
      var data = typeof text === 'string' ? enc(text) : text;
      if (f) f.content = data; else CFB.utils.cfb_add(zip, path, data);
    }
    var ct = get('/[Content_Types].xml');
    if (!ct) throw new Error('xlsx 구조를 읽지 못했습니다.');
    if (!/Extension="png"/i.test(ct)) ct = ct.replace('<Default ', '<Default Extension="png" ContentType="image/png"/><Default ');
    var bySheet = {};
    images.forEach(function (im, i) { im._n = i + 1; (bySheet[im.sheet] = bySheet[im.sheet] || []).push(im); });
    var dNo = 0;
    Object.keys(bySheet).forEach(function (sn) {
      dNo++;
      var list = bySheet[sn];
      var sheetPath = '/xl/worksheets/sheet' + sn + '.xml', relPath = '/xl/worksheets/_rels/sheet' + sn + '.xml.rels';
      var sheet = get(sheetPath);
      if (!sheet) throw new Error('시트 ' + sn + ' 를 찾지 못했습니다.');
      // 그림 파일 + 도면 XML
      var anchors = '', drels = '';
      list.forEach(function (im, k) {
        put('/xl/media/image' + im._n + '.png', im.png);
        drels += '<Relationship Id="rId' + (k + 1) + '" Type="' + NS_R + '/image" Target="../media/image' + im._n + '.png"/>';
        var cx = Math.round(im.width * EMU), cy = Math.round(im.height * EMU);
        anchors += '<xdr:oneCellAnchor><xdr:from><xdr:col>' + (im.col || 0) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + (im.row || 0) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
          '<xdr:ext cx="' + cx + '" cy="' + cy + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (k + 2) + '" name="' + esc(im.name || ('그림 ' + (k + 1))) + '" descr="' + esc(im.name || '') + '"/>' +
          '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (k + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
          '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
      });
      put('/xl/drawings/drawing' + dNo + '.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + NS_R + '">' + anchors + '</xdr:wsDr>');
      put('/xl/drawings/_rels/drawing' + dNo + '.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drels + '</Relationships>');
      ct = ct.replace('</Types>', '<Override PartName="/xl/drawings/drawing' + dNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
      // 시트 → 도면 관계
      var rels = get(relPath) || '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      var rid = 'rIdImg' + dNo;
      rels = rels.replace('</Relationships>', '<Relationship Id="' + rid + '" Type="' + NS_R + '/drawing" Target="../drawings/drawing' + dNo + '.xml"/></Relationships>');
      put(relPath, rels);
      // <drawing> 은 legacyDrawing·tableParts·extLst 보다 앞, 나머지보다 뒤(스키마 순서)
      if (!/xmlns:r=/.test(sheet)) sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="' + NS_R + '" ');
      var tag = '<drawing r:id="' + rid + '"/>';
      var m = sheet.match(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>\/]/);
      sheet = m ? sheet.slice(0, m.index) + tag + sheet.slice(m.index) : sheet.replace('</worksheet>', tag + '</worksheet>');
      put(sheetPath, sheet);
    });
    put('/[Content_Types].xml', ct);
    return CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
  }

  var api = { addImages: addImages };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HNXlsxImage = api;
})(typeof window !== 'undefined' ? window : this);
