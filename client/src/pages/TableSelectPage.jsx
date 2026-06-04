import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import socket from '../socket';

export default function TableSelectPage() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ['tables'],
    queryFn:  () => api.getTables(),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!tables.length) return;
    tables.forEach(t => socket.emit('client:subscribe_table', { tableId: t.id }));
    const handler = ({ tableId, status }) => {
      queryClient.setQueryData(['tables'], prev =>
        prev?.map(t => t.id === tableId ? { ...t, status } : t)
      );
    };
    socket.on('table:status_changed', handler);
    return () => {
      tables.forEach(t => socket.emit('client:unsubscribe_table', { tableId: t.id }));
      socket.off('table:status_changed', handler);
    };
  }, [tables, queryClient]);

  return (
    <div className="flex flex-col min-h-screen select-none" style={{ background: '#0b0b0f' }}>
      {/* ヘッダー */}
      <div className="flex items-center justify-center pt-12 pb-8 flex-shrink-0">
        <img src="/FANZONE_logo_A2.png" alt="ロゴ" style={{ height: 48, width: 'auto' }} />
      </div>

      {/* 案内テキスト */}
      <div className="text-center mb-10 flex-shrink-0">
        <p style={{ color: '#3a3a50', fontSize: 13, letterSpacing: '3px', fontFamily: "'Bebas Neue', sans-serif", marginBottom: 6 }}>
          STAFF — SELECT TABLE
        </p>
        <p style={{ color: '#f0f0f5', fontSize: 28, fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 900 }}>
          テーブルを選択してください
        </p>
      </div>

      {/* テーブルグリッド */}
      <div className="flex-1 px-8 pb-12">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <span style={{ color: '#3a3a50', letterSpacing: '3px', fontSize: 14 }}>LOADING...</span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-5 max-w-2xl mx-auto">
            {tables.map(table => (
              <button
                key={table.id}
                onClick={() => navigate(`/table/${table.id}`)}
                className="aspect-square flex flex-col items-center justify-center active:scale-95"
                style={{
                  background: '#1e1e28',
                  border: '1px solid #252532',
                  borderRadius: 18,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background  = '#e52233';
                  e.currentTarget.style.borderColor = '#e52233';
                  e.currentTarget.style.boxShadow   = '0 0 20px rgba(229,34,51,0.4)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background  = '#1e1e28';
                  e.currentTarget.style.borderColor = '#252532';
                  e.currentTarget.style.boxShadow   = 'none';
                }}
              >
                {/* ステータスドット */}
                <div style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background:  table.status === 'available' ? '#22c55e' : '#e52233',
                  boxShadow:   table.status === 'available'
                    ? '0 0 6px rgba(34,197,94,0.6)'
                    : '0 0 6px rgba(229,34,51,0.6)',
                }} />
                <span style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 32,
                  color: '#f0f0f5',
                  lineHeight: 1,
                  letterSpacing: '2px',
                }}>
                  {table.name}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color:       table.status === 'available' ? '#22c55e' : '#e52233',
                  marginTop:   6,
                  letterSpacing: '1px',
                }}>
                  {table.status === 'available' ? '空席' : '使用中'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
