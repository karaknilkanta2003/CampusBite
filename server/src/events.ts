import type { Response } from 'express';

// Server-Sent Events hub. Channels:
//   public              canteen status, crowd and menu availability for everyone
//   user:<id>           one student's order updates
//   kitchen:<canteenId> new and changed orders for that kitchen
//   board:<canteenId>   pickup board codes

interface Client {
  res: Response;
  channels: Set<string>;
}

const clients = new Set<Client>();

export function subscribe(res: Response, channels: string[]): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client: Client = { res, channels: new Set(channels) };
  clients.add(client);
  return () => clients.delete(client);
}

export function publish(channel: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (c.channels.has(channel)) c.res.write(payload);
  }
}

export function hasSubscribers(channel: string): boolean {
  for (const c of clients) if (c.channels.has(channel)) return true;
  return false;
}

export function connectedClients(): number {
  return clients.size;
}

// Keep tunnels, proxies and mobile networks from closing idle connections.
setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 15_000).unref();
