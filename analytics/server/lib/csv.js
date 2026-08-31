'use strict';
// CSV 生成（Excel 互換: UTF-8 BOM 付き・CRLF・カンマ/引用符/改行はダブルクォートでエスケープ）

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// headers: 文字列配列、rows: セル配列の配列
function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((cols) => cols.map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// attachment として CSV を返す。filename は ASCII のみ（report名 + 日付）を想定
function sendCsv(res, filename, headers, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(headers, rows));
}

module.exports = { csvCell, toCsv, sendCsv };
