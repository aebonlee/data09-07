// 예시 파일 만들기: node scripts/make-samples.js
// samples/ 에 가상 도면 PDF 3건과 도면 대장 엑셀 1건을 만듭니다. 모두 「예시데이터」 로 시작하는 가상 자료입니다.
// PDF 는 제목란 글자만 있는 단순 도면입니다(영문 글꼴 Helvetica — 한글 없이 만들어 외부 글꼴이 필요 없음).
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');

const OUT = path.join(__dirname, '..', 'samples');
fs.mkdirSync(OUT, { recursive: true });

function pdfEscape(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

// 아주 작은 PDF 1쪽: 외곽선 + 하네스 모양 선 + 오른쪽 아래 제목란 글자
function makePdf(lines, notes) {
  const W = 842, H = 595; // A4 가로
  let c = '0.8 w 20 20 802 555 re S\n';
  c += '2 w 80 380 m 420 380 l S 420 380 m 520 460 l S 420 380 m 520 300 l S 250 380 m 250 250 l S\n';
  c += '1 w 520 30 302 150 re S\n';
  c += 'BT /F1 9 Tf 12 TL 530 165 Td\n';
  lines.forEach((l, i) => { c += (i ? 'T* ' : '') + '(' + pdfEscape(l) + ') Tj\n'; });
  c += 'ET\n';
  c += 'BT /F1 9 Tf 12 TL 40 560 Td\n';
  notes.forEach((l, i) => { c += (i ? 'T* ' : '') + '(' + pdfEscape(l) + ') Tj\n'; });
  c += 'ET\n';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(c, 'latin1') + ' >>\nstream\n' + c + 'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offs.forEach(o => { out += String(o).padStart(10, '0') + ' 00000 n \n'; });
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const pdfs = [
  ['예시데이터_HN-A0231_C.pdf', ['PART NO. HN-A0231 | REV C', 'TITLE: HARNESS ASSY-MAIN', 'MODEL X1 | CUST. A', 'APPLY: ???', 'CIRCUITS: 38 | BRANCHES: 6', 'SAMPLE DATA - NOT A REAL DRAWING'],
    ['NOTE: CN-0118 CN-0120 CN-0131 CN-0140 CN-0221', 'WIRE WR-0085 / TUBE TB-0019 CORRUGATE TAPE', 'OPT-2 CIRCUIT ADDED']],
  ['예시데이터_HN-B0412_A.pdf', ['PART NO. HN-B0412 | REV A', 'TITLE: HARNESS ASSY-ENGINE', 'MODEL Y2 | CUST. B', 'APPLY: ENGINE', 'CIRCUITS: 22 | BRANCHES: 4', 'SAMPLE DATA - NOT A REAL DRAWING'],
    ['NOTE: CN-0300 CN-0310 WATERPROOF', 'WIRE WR-0125']],
  ['예시데이터_HN-A0250_A.pdf', ['PART NO. HN-A0250 | REV A', 'TITLE: HARNESS ASSY-PANEL', 'MODEL X2 | CUST. A', 'APPLY: PANEL', 'CIRCUITS: 15 | BRANCHES: 2', 'SAMPLE DATA - NOT A REAL DRAWING'],
    ['NOTE: CN-0180 CN-0181 SHIELD', 'WIRE WR-0050']]
];
pdfs.forEach(([name, lines, notes]) => {
  const buf = makePdf(lines, notes);
  fs.writeFileSync(path.join(OUT, name), buf);
  const head = buf.slice(0, 5).toString('latin1');
  if (head !== '%PDF-') throw new Error('PDF 머리 확인 실패 ' + name);
  console.log('  PDF ', name, buf.length + 'B');
});

// 도면 대장 — 일부러 도구와 다른 열 이름(열 맞추기 시연용)
const rows = [
  ['도번', 'Rev.', '품명', '고객', '차종', '용도', '커넥터', '회로', '분기', '비고'],
  ['HN-D0101', 'A', 'MAIN 하네스', '고객사 D', 'W1', 'MAIN', 'CN-0600, CN-0601', 30, 5, '예시 데이터'],
  ['HN-D0102', 'B', 'CABIN 하네스', '고객사 D', 'W1', 'CABIN', 'CN-0610', 12, 2, '예시 데이터'],
  ['HN-D0103', 'A', 'MAIN 하네스(옵션)', '고객사 D', 'W1-L', 'MAIN', 'CN-0600, CN-0602', 32, 5, '예시 데이터'],
  ['', 'A', '품번 없는 행(건너뜀 확인용)', '고객사 D', 'W1', 'MAIN', '', '', '', '예시 데이터']
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '도면대장');
const xf = path.join(OUT, '예시데이터_도면대장.xlsx');
fs.writeFileSync(xf, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
// 다시 읽어 열 추측이 되는지 확인
const back = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(xf), { type: 'buffer' }).Sheets['도면대장'], { defval: '' });
const map = L.guessMapping(Object.keys(back[0]));
if (map.partNo !== '도번' || map.rev !== 'Rev.' || map.usage !== '용도') throw new Error('열 추측 확인 실패 ' + JSON.stringify(map));
const db = L.emptyDb();
const r = L.importRows(db, back, map, new Date());
if (r.added !== 3 || r.skipped.length !== 1) throw new Error('가져오기 확인 실패 ' + JSON.stringify(r));
console.log('  XLSX', path.basename(xf), '— 다시 읽어 3건 추가·1건 건너뜀 확인');
