import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import CashDenomModal from '../components/pos/CashDenomModal';

export default function RegisterStartPage() {
  const [now, setNow] = useState(new Date());
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const dateStr = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  // 金種入力モーダル
  const [showDenomModal, setShowDenomModal] = useState(false);
  const [denomCounts,    setDenomCounts]    = useState({});
  const [openError,      setOpenError]      = useState('');
  const [opening,        setOpening]        = useState(false);

  const handleDenomChange = (denomValue, count) => {
    setDenomCounts(prev => ({ ...prev, [denomValue]: count }));
  };

  const handleDenomConfirm = async (total) => {
    if (opening) return; // 二重オープン防止
    setOpening(true);
    setOpenError('');
    try {
      await api.updateSystemSettings({ register_open: true, register_open_cash: total });
      queryClient.invalidateQueries({ queryKey: ['system-settings'] });
      navigate('/');
    } catch (e) {
      console.error('レジオープンに失敗しました', e);
      setOpenError(e?.message || 'レジのオープンに失敗しました。通信状態を確認して再度お試しください。');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center select-none">

      {openError && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-lg bg-red-600 text-white text-sm font-medium shadow-lg">
          ⚠ {openError}
        </div>
      )}

      {/* ロゴ */}
      <img src="/FANZONE_logo_A2.png" alt="ロゴ" className="h-16 w-auto object-contain mb-10" />

      {/* 時計 */}
      <div className="tabular-nums font-mono font-thin text-white leading-none mb-4"
        style={{ fontSize: 'clamp(64px, 12vw, 128px)', letterSpacing: '-0.02em' }}
      >
        {timeStr}
      </div>

      {/* 日付 */}
      <p className="text-slate-400 text-lg mb-16">
        {dateStr}
      </p>

      {/* オープンボタン */}
      <button
        onClick={() => setShowDenomModal(true)}
        className="px-20 py-4 bg-sky-400 hover:bg-sky-500 active:bg-sky-600 text-white text-xl font-bold rounded-2xl transition-colors shadow-lg shadow-sky-900/40"
      >
        オープン
      </button>

      {/* 下部クレジット */}
      <p className="absolute bottom-6 text-slate-600 text-xs tracking-widest">
        REGISTER CLOSED
      </p>

      {/* 金種入力モーダル */}
      {showDenomModal && (
        <CashDenomModal
          title="開店準備金　金種入力"
          denomCounts={denomCounts}
          onChange={handleDenomChange}
          onConfirm={handleDenomConfirm}
          onCancel={() => setShowDenomModal(false)}
        />
      )}
    </div>
  );
}
