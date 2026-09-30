// 로고 사본 갱신: node scripts/make-logo-js.js
// img/logo.png 를 읽어 js/brand-logo.js 의 data URI(B64)와 가로·세로 값을 바꿉니다.
// 출력물(엑셀 · 비교 그림 PNG)은 js/brand-logo.js 의 사본을 쓰므로, 로고를 바꾸면 이 스크립트를 한 번 돌립니다.
// test/logic.test.mjs 가 두 파일이 같은지 확인합니다.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const png = fs.readFileSync(path.join(root, 'img/logo.png'));
if (png.readUInt32BE(12) !== 0x49484452) throw new Error('img/logo.png 가 PNG 가 아닙니다.');
const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
const file = path.join(root, 'js/brand-logo.js');
let js = fs.readFileSync(file, 'utf8');
const before = js;
js = js.replace(/var B64 = '[^']*';/, "var B64 = '" + png.toString('base64') + "';")
  .replace(/width: \d+,/, 'width: ' + w + ',').replace(/height: \d+,/, 'height: ' + h + ',');
if (!/var B64 = '/.test(before)) throw new Error('js/brand-logo.js 에서 B64 자리를 찾지 못했습니다.');
fs.writeFileSync(file, js);
console.log(js === before ? '바뀐 것 없음' : 'js/brand-logo.js 갱신', w + '×' + h, png.length + ' 바이트');
