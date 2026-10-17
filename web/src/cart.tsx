import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** One cart per canteen, kept on the device so a refresh does not lose it. */
type Carts = Record<string, Record<number, number>>;

interface CartApi {
  qty: (canteenId: string, itemId: number) => number;
  lines: (canteenId: string) => { menuItemId: number; qty: number }[];
  add: (canteenId: string, itemId: number) => void;
  remove: (canteenId: string, itemId: number) => void;
  clear: (canteenId: string) => void;
}

const KEY = 'campusbite.carts';
const CartContext = createContext<CartApi | null>(null);

function load(): Carts {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Carts;
  } catch {
    return {};
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [carts, setCarts] = useState<Carts>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(carts));
    } catch {
      // storage full or blocked: the cart still works for this visit
    }
  }, [carts]);

  const change = useCallback((canteenId: string, itemId: number, delta: number) => {
    setCarts((all) => {
      const cart = { ...(all[canteenId] ?? {}) };
      const next = (cart[itemId] ?? 0) + delta;
      if (next <= 0) delete cart[itemId];
      else cart[itemId] = Math.min(next, 10);
      return { ...all, [canteenId]: cart };
    });
  }, []);

  const value: CartApi = {
    qty: (c, i) => carts[c]?.[i] ?? 0,
    lines: (c) => Object.entries(carts[c] ?? {}).map(([id, qty]) => ({ menuItemId: Number(id), qty })),
    add: (c, i) => change(c, i, 1),
    remove: (c, i) => change(c, i, -1),
    clear: (c) => setCarts((all) => ({ ...all, [c]: {} })),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const c = useContext(CartContext);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}
