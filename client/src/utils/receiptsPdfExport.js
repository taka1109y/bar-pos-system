import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

const PAYMENT_LABELS = { cash: '現金', card: 'カード', emoney: '電子マネー', split: '分割' };
const RECEIPT_TYPE_LABELS = {
  normal:          '黒伝票',
  red:             '赤伝票',
  void:            '【取消】',
  black_cancelled: '【黒取消】',
};

const RECEIPT_TYPE_BADGE = {
  normal:          { color: '#374151', background: '#f3f4f6' },
  red:             { color: '#dc2626', background: '#fee2e2' },
  void:            { color: '#d97706', background: '#fef3c7' },
  black_cancelled: { color: '#6b7280', background: '#f3f4f6' },
};

function fmtTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function yen(n) {
  return `¥${Math.floor(n ?? 0).toLocaleString()}`;
}

function buildReceiptBlock(r) {
  const isVoid     = r.receipt_type === 'void' || r.receipt_type === 'black_cancelled';
  const typeLabel  = RECEIPT_TYPE_LABELS[r.receipt_type] ?? '';
  const typeBadge  = RECEIPT_TYPE_BADGE[r.receipt_type] ?? { color: '#374151', background: '#f3f4f6' };
  const payLabel   = r.payment_method === 'split'
    ? `分割 ${['cash', 'card', 'emoney'].filter((k) => (r[`${k}_amount`] ?? 0) > 0).map((k) => `${PAYMENT_LABELS[k]}${yen(r[`${k}_amount`])}`).join(' / ')}`
    : (PAYMENT_LABELS[r.payment_method] ?? r.payment_method);
  const dt        = fmtTime(r.closed_at ?? r.opened_at);
  const items     = (r.items ?? []).filter(i => i.item_name);
  const itemsSub  = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);

  const hasCharge   = (r.charge_amount    ?? 0) > 0;
  const hasLate     = (r.late_night_amount ?? 0) > 0;
  const hasDiscount = (r.discount_amount   ?? 0) > 0;
  const hasGift     = (r.gift_cert_amount  ?? 0) > 0;
  const hasExtra    = hasCharge || hasLate || hasDiscount || hasGift;

  let html = `
    <div style="border-bottom:1px solid #e2e8f0;margin-bottom:14px;padding-bottom:14px;${isVoid ? 'opacity:0.72;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span style="font-weight:bold;font-size:13px;color:${isVoid ? '#94a3b8' : '#1e293b'};">${r.table_name ?? '-'}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:#64748b;">${dt}</span>
          ${typeLabel ? `<span style="font-size:10px;font-weight:bold;color:${typeBadge.color};background:${typeBadge.background};padding:1px 6px;border-radius:4px;">${typeLabel}</span>` : ''}
        </div>
      </div>
      <div style="font-size:10px;color:#94a3b8;margin-bottom:7px;">
        伝票 #${r.id}　${payLabel}${r.guest_count > 0 ? `　${r.guest_count}名様` : ''}
      </div>
  `;

  // 商品明細
  if (items.length > 0) {
    html += `<div style="border-top:1px solid #f1f5f9;padding-top:5px;margin-bottom:5px;">`;
    for (const item of items) {
      html += `
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:#334155;">
          <span>${item.item_name} × ${item.quantity}</span>
          <span>${yen(item.unit_price * item.quantity)}</span>
        </div>`;
    }
    html += `</div>`;
  }

  // 小計・追加料金・合計
  html += `<div style="border-top:1px solid #e2e8f0;padding-top:5px;margin-top:2px;">`;

  if (!isVoid) {
    if (hasExtra && items.length > 0) {
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-bottom:2px;"><span>商品合計（税込み）</span><span>${yen(itemsSub)}</span></div>`;
    }
    if (hasCharge) {
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#64748b;margin-bottom:2px;"><span>チャージ（${r.guest_count}名 × ${yen(r.charge_per_person)}）</span><span>${yen(r.charge_amount)}</span></div>`;
    }
    if (hasLate) {
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#d97706;margin-bottom:2px;"><span>深夜料金（+${Math.round((r.late_night_rate ?? 0) * 100)}%）</span><span>+${yen(r.late_night_amount)}</span></div>`;
    }
    if (hasDiscount) {
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#ef4444;margin-bottom:2px;"><span>割引</span><span>−${yen(r.discount_amount)}</span></div>`;
    }
    if (hasGift) {
      html += `<div style="display:flex;justify-content:space-between;font-size:10px;color:#10b981;margin-bottom:2px;"><span>金券適用${r.gift_cert_no_change ? '（釣り無し）' : ''}</span><span>−${yen(r.gift_cert_amount)}</span></div>`;
    }
    html += `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;color:#1e293b;padding-top:3px;border-top:1px solid #e2e8f0;margin-top:2px;"><span>合計（税込み）</span><span>${yen(r.total_amount)}</span></div>`;
  } else {
    html += `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;color:#ef4444;"><span>合計（税込み）</span><span>${yen(r.total_amount)}</span></div>`;
  }

  html += `</div></div>`;
  return html;
}

export async function exportReceiptsPdf(receipts, date) {
  if (!receipts || receipts.length === 0) return;

  const sorted = [...receipts].sort((a, b) =>
    new Date(a.closed_at ?? a.opened_at).getTime() - new Date(b.closed_at ?? b.opened_at).getTime()
  );
  const normalList = sorted.filter(r => r.receipt_type === 'normal' || r.receipt_type === 'red');
  const cancelList = sorted.filter(r => r.receipt_type === 'void'   || r.receipt_type === 'black_cancelled');

  let html = `
    <div style="border-bottom:2px solid #2b70ef;padding-bottom:10px;margin-bottom:20px;">
      <h1 style="font-size:18px;font-weight:900;color:#2b70ef;margin:0 0 4px;">伝票一覧</h1>
      <span style="font-size:11px;color:#64748b;">${date}　全 ${receipts.length} 件（通常・赤 ${normalList.length} 件 / 取消 ${cancelList.length} 件）</span>
    </div>
  `;

  for (const r of normalList) html += buildReceiptBlock(r);

  if (cancelList.length > 0) {
    html += `<div style="margin:8px 0 12px;padding:4px 8px;background:#fef2f2;border-left:3px solid #ef4444;"><span style="font-size:10px;font-weight:bold;color:#ef4444;">取消・黒取消 伝票</span></div>`;
    for (const r of cancelList) html += buildReceiptBlock(r);
  }

  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:#fff;padding:32px;font-family:Hiragino Sans,Hiragino Kaku Gothic ProN,Noto Sans JP,sans-serif;box-sizing:border-box;';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas  = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', logging: false });
    const imgData = canvas.toDataURL('image/png');
    const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pgW     = pdf.internal.pageSize.getWidth();
    const pgH     = pdf.internal.pageSize.getHeight();
    const iH      = (canvas.height * pgW) / canvas.width;

    if (iH <= pgH) {
      pdf.addImage(imgData, 'PNG', 0, 0, pgW, iH);
    } else {
      let yPos = 0;
      while (yPos < iH) {
        if (yPos > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -yPos, pgW, iH);
        yPos += pgH;
      }
    }

    pdf.save(`${date}_伝票一覧.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
