import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive, useNow } from '../live';
import type { Canteen } from '../types';
import { clock, minutesFromNow } from '../format';
import { Spinner } from '../components/ui';

interface BoardData {
  canteenId: string;
  preparing: { code: string; slot: string; etaAt: number | null }[];
  ready: { code: string; shelf: number | null }[];
}

/** Full-screen pickup board for a TV at the counter. No sign-in needed. */
export function Board() {
  const { id = '' } = useParams();
  const now = useNow(15_000);
  const [canteen, setCanteen] = useState<Canteen | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [soldOut, setSoldOut] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ canteen: Canteen; board: BoardData; soldOut: string[] }>(`/board/${id}`)
      .then((r) => {
        setCanteen(r.canteen);
        setBoard(r.board);
        setSoldOut(r.soldOut);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  useLive(
    {
      board: (b: BoardData) => b.canteenId === id && setBoard(b),
      canteen: (c: Canteen) => c.id === id && setCanteen(c),
      menu: (m: { canteenId: string; items: { name: string; available: boolean }[] }) =>
        m.canteenId === id && setSoldOut(m.items.filter((i) => !i.available).map((i) => i.name)),
    },
    { board: id },
    { resync: load, pollMs: 10_000 },
  );

  if (error) return <div className="board"><h1>{error}</h1></div>;
  if (!canteen || !board) return <div className="board"><Spinner /></div>;

  return (
    <div className="board">
      <div className="row-between wrap">
        <div className="stack-sm">
          <span style={{ fontSize: 'clamp(24px, 3vw, 38px)', fontWeight: 800 }}>{canteen.name} · Order pickup</span>
          <span style={{ fontSize: 'clamp(15px, 1.5vw, 19px)', fontWeight: 600, color: '#aeb6c2' }}>Find your code, then take your food from that shelf.</span>
        </div>
        <span className="mono" style={{ fontSize: 'clamp(22px, 2.6vw, 34px)', fontWeight: 700, color: '#aeb6c2' }}>{clock(now)}</span>
      </div>

      <div className="board-grid">
        <section className="board-col" aria-label="Preparing">
          <div className="row">
            <span style={{ width: 14, height: 14, borderRadius: 7, background: '#e0a03a' }} />
            <h2 style={{ fontSize: 22 }}>Preparing</h2>
          </div>
          {board.preparing.length === 0 && <span style={{ color: '#6b7a90' }}>No orders in the kitchen.</span>}
          {board.preparing.slice(0, 10).map((p) => {
            const m = p.etaAt ? minutesFromNow(p.etaAt, now) : null;
            return (
              <div key={p.code} className="row-between" style={{ borderBottom: '1px solid #2a3445', paddingBottom: 10 }}>
                <span className="board-code" style={{ fontSize: 32, color: '#dde3ea' }}>{p.code}</span>
                <span style={{ fontSize: 17, fontWeight: 700, color: '#aeb6c2' }}>{m !== null && m > 0 ? `about ${m} min` : 'any moment'}</span>
              </div>
            );
          })}
        </section>

        <section className="board-col ready" aria-label="Ready to collect" aria-live="polite">
          <div className="row">
            <span style={{ width: 14, height: 14, borderRadius: 7, background: '#3ccb95' }} />
            <h2 style={{ fontSize: 22 }}>Ready: collect now</h2>
          </div>
          {board.ready.length === 0 && <span style={{ color: '#7fbfa6' }}>Nothing waiting.</span>}
          {board.ready.map((r) => (
            <div key={r.code} className="board-ready-row">
              <span className="board-code" style={{ fontSize: 44 }}>{r.code}</span>
              <div className="board-shelf">
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{r.shelf ? 'Shelf' : 'Ask at'}</span>
                <span className="mono" style={{ fontSize: r.shelf ? 30 : 18, fontWeight: 700, lineHeight: 1 }}>{r.shelf ?? 'counter'}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="board-col" aria-label="Order ahead">
          <div className="row">
            <span style={{ width: 14, height: 14, borderRadius: 7, background: '#6b7a90' }} />
            <h2 style={{ fontSize: 22 }}>Skip this queue next time</h2>
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, color: '#c7ced8', lineHeight: 1.45 }}>
            Order on CampusBite, pick a time that fits your class break, and just collect.
          </span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: '#9db2ff', wordBreak: 'break-all' }}>{window.location.host}</span>
          <span style={{ marginTop: 'auto', fontSize: 15, fontWeight: 600, color: '#aeb6c2' }}>
            {soldOut.length ? `Sold out today: ${soldOut.join(', ')}` : 'Everything on the menu is available.'}
          </span>
        </section>
      </div>
    </div>
  );
}
