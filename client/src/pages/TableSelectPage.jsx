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

  const tableSeat   = tables.filter(t => t.table_type === 'table');
  const counterSeat = tables.filter(t => t.table_type === 'counter');

  const TableCard = ({ table }) => (
    <button
      onClick={() => navigate(`/table/${table.id}`)}
      className="active:scale-95 flex flex-col items-center justify-center"
      style={{
        width: 96,
        height: 96,
        background: '#1e1e28',
        border: '1px solid #252532',
        borderRadius: 14,
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background  = '#e52233';
        e.currentTarget.style.borderColor = '#e52233';
        e.currentTarget.style.boxShadow   = '0 0 16px rgba(229,34,51,0.4)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background  = '#1e1e28';
        e.currentTarget.style.borderColor = '#252532';
        e.currentTarget.style.boxShadow   = 'none';
      }}
    >
      <div style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: table.status === 'available' ? '#22c55e' : '#e52233',
        boxShadow:  table.status === 'available'
          ? '0 0 5px rgba(34,197,94,0.7)'
          : '0 0 5px rgba(229,34,51,0.7)',
      }} />
      <span style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 24,
        color: '#f0f0f5',
        lineHeight: 1,
        letterSpacing: '2px',
      }}>
        {table.name}
      </span>
      <span style={{
        fontSize: 10,
        fontWeight: 600,
        color: table.status === 'available' ? '#22c55e' : '#e52233',
        marginTop: 5,
        letterSpacing: '1px',
      }}>
        {table.status === 'available' ? '空席' : '使用中'}
      </span>
    </button>
  );

  const SectionLabel = ({ label }) => (
    <p style={{
      color: '#3a3a50',
      fontSize: 11,
      letterSpacing: '3px',
      fontFamily: "'Bebas Neue', sans-serif",
      marginBottom: 12,
      textAlign: 'center',
    }}>
      {label}
    </p>
  );

  return (
    <div className="flex flex-col min-h-screen select-none" style={{ background: '#0b0b0f' }}>
      <div className="flex items-center justify-center pt-10 pb-6 flex-shrink-0">
        <img src="/FANZONE_logo_A2.png" alt="ロゴ" style={{ height: 44, width: 'auto' }} />
      </div>

      <div className="text-center mb-8 flex-shrink-0">
        <p style={{ color: '#3a3a50', fontSize: 12, letterSpacing: '3px', fontFamily: "'Bebas Neue', sans-serif", marginBottom: 4 }}>
          STAFF — SELECT TABLE
        </p>
        <p style={{ color: '#f0f0f5', fontSize: 24, fontFamily: "'Noto Sans JP', sans-serif", fontWeight: 900 }}>
          テーブルを選択してください
        </p>
      </div>

      <div className="flex-1 px-6 pb-10 flex flex-col items-center gap-10">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <span style={{ color: '#3a3a50', letterSpacing: '3px', fontSize: 14 }}>LOADING...</span>
          </div>
        ) : (
          <>
            {tableSeat.length > 0 && (
              <div className="flex flex-col items-center">
                <SectionLabel label="— TABLE —" />
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: 12,
                  maxWidth: 360,
                }}>
                  {tableSeat.map(table => <TableCard key={table.id} table={table} />)}
                </div>
              </div>
            )}

            {tableSeat.length > 0 && counterSeat.length > 0 && (
              <div style={{ width: 120, height: 1, background: '#252532' }} />
            )}

            {counterSeat.length > 0 && (
              <div className="flex flex-col items-center">
                <SectionLabel label="— COUNTER —" />
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: 12,
                  maxWidth: 480,
                }}>
                  {counterSeat.map(table => <TableCard key={table.id} table={table} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
