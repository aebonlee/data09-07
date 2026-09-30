/* 회사 로고(천일테크윈) — 출력물(엑셀 · 비교 그림 PNG)에 넣을 때 쓰는 사본.
   img/logo.png(155×128, 약 3KB)와 같은 그림을 data URI 로 담았습니다.
   파일(file://)로 연 도구에서는 img/logo.png 를 fetch 로 읽을 수 없고, 캔버스에 그리면 캔버스가 오염돼 PNG 저장이 막히기 때문입니다.
   로고를 바꾸면 img/logo.png 와 이 파일을 함께 바꿉니다: node scripts/make-logo-js.js  (2026-09-30) */
(function (root) {
  'use strict';
  var B64 = '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';
  var api = {
    alt: '천일테크윈 로고',
    width: 155,
    height: 128,
    dataUri: 'data:image/png;base64,' + B64,
    // PNG 바이트 (엑셀에 넣을 때). 같은 배열을 돌려주어 한 파일 안에서는 그림 파일 하나를 함께 씁니다.
    bytes: function () {
      if (api._bytes) return api._bytes;
      var bin = typeof atob === 'function' ? atob(B64) : Buffer.from(B64, 'base64').toString('binary');
      var u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return (api._bytes = u);
    },
    // 높이 h 픽셀에 맞춘 폭 (가로세로 비율 유지)
    widthFor: function (h) { return Math.round(h * api.width / api.height); },
    img: null
  };
  // 캔버스에 그릴 그림을 미리 불러 둡니다(data URI 라 곧바로 끝나고 캔버스를 오염시키지 않음)
  if (typeof Image !== 'undefined') { api.img = new Image(); api.img.src = api.dataUri; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HNLogo = api;
})(typeof window !== 'undefined' ? window : this);
