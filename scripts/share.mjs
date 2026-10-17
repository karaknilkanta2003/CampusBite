// Shares CampusBite through a public HTTPS link, so phones can open it on any network
// (college Wi-Fi, mobile data) without being on the same LAN as this laptop.
//
//   npm run share
//
// It builds the web app, starts the server on port 8080 and opens a free tunnel to it:
// a Cloudflare quick tunnel, or Pinggy over port 443 when the network blocks Cloudflare.
// Anyone with the link can open the app, so stop it (Ctrl+C) when you finish.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { bin, install, Tunnel } from 'cloudflared';
import qrcode from 'qrcode-terminal';

const isWindows = process.platform === 'win32';
let PORT = process.env.PORT ?? '8080';
const children = [];
let tunnel = null;

function stop(code = 0) {
  tunnel?.stop();
  for (const p of children) {
    if (p.exitCode !== null || !p.pid) continue;
    if (isWindows) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode !== null) throw new Error('The CampusBite server stopped while starting (see the messages above).');
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start on ${url}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(Number(port));
  });
}

async function isCampusBite(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}

/** Process ids listening on a TCP port. */
function listeners(port) {
  if (isWindows) {
    const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).stdout ?? '';
    const pids = out
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      // columns: Proto  Local-Address  Foreign-Address  State  PID
      .filter((cols) => cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`))
      .map((cols) => cols[4]);
    return [...new Set(pids)];
  }
  const out = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? '';
  return out.split(/\s+/).filter(Boolean);
}

/**
 * Makes sure the port is ours. An old CampusBite server left running (for example after closing a
 * terminal window) is stopped; anything else keeps its port and we move to the next free one.
 */
async function claimPort() {
  if (await portFree(PORT)) return;
  if (await isCampusBite(PORT)) {
    console.log(`   An old CampusBite server is still running on port ${PORT}. Stopping it…`);
    for (const pid of listeners(PORT)) {
      if (isWindows) spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
      else spawnSync('kill', [pid]);
    }
    for (let i = 0; i < 20 && !(await portFree(PORT)); i++) await sleep(250);
    if (await portFree(PORT)) return;
  }
  const taken = PORT;
  for (let p = Number(PORT) + 1; p < Number(PORT) + 50; p++) {
    if (await portFree(p)) {
      PORT = String(p);
      console.log(`   Port ${taken} is used by another program, so CampusBite will use port ${PORT}.`);
      return;
    }
  }
  console.error(`No free port found near ${taken}. Close other servers and try again.`);
  stop(1);
}

console.log('1/3 Building the web app…');
const build = spawnSync('npm run build', { stdio: 'inherit', shell: true });
if (build.status !== 0) stop(build.status ?? 1);

await claimPort();
console.log(`2/3 Starting CampusBite on port ${PORT}…`);
const server = spawn('npm run start', {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PORT,
    // Demo accounts have no real inbox, so sign-in codes are filled in on screen for every account.
    // Set DEV_CODES=students to keep kitchen and admin codes in this terminal only.
    DEV_CODES: process.env.DEV_CODES ?? 'all',
  },
});
children.push(server);
server.on('exit', (code) => code && stop(code));
await waitForServer(`http://localhost:${PORT}/api/health`).catch((err) => {
  console.error(err.message);
  stop(1);
});

function announce(url, via) {
  console.log('\n=====================================================================');
  console.log(` CampusBite is online (via ${via}). Open this link on any phone, on any network:`);
  console.log(`\n   ${url}\n`);
  qrcode.generate(url, { small: true });
  console.log(`   Students:     ${url}/`);
  console.log(`   Kitchen:      ${url}/kitchen   (kitchen.bbc@iiit.ac.in)`);
  console.log(`   Pickup board: ${url}/board/bbc`);
  console.log(`   Admin:        ${url}/admin     (admin@iiit.ac.in)`);
  console.log('\n No email needed: tap a demo account on the sign-in screen, or type any address');
  console.log(' and the code is filled in for you. Codes are also printed below as "[email] Sign-in code…".');
  console.log(' Anyone with the link can open the app. Press Ctrl+C to stop sharing.');
  console.log('=====================================================================\n');
}

/** Cloudflare quick tunnel. Needs outbound port 7844, which many campus networks block. */
async function tryCloudflare() {
  if (!fs.existsSync(bin)) await install(bin);
  const t = Tunnel.quick(`http://localhost:${PORT}`);
  let url = null;
  t.on('url', (u) => (url = u));
  const ok = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 25_000);
    t.once('connected', () => {
      clearTimeout(timer);
      resolve(true);
    });
    t.once('exit', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (!ok || !url) {
    t.stop();
    return false;
  }
  tunnel = t;
  t.on('exit', () => {
    console.error('[tunnel] Cloudflare tunnel stopped. Run npm run share again.');
    stop(1);
  });
  announce(url, 'Cloudflare');
  return true;
}

/**
 * Pinggy tunnel over SSH on port 443, which networks almost never block. Free tunnels last
 * 60 minutes, so a new one (with a new link) is opened automatically when one ends.
 */
function startPinggy() {
  const ssh = spawn(
    'ssh',
    ['-p', '443', '-o', 'StrictHostKeyChecking=no', '-o', `UserKnownHostsFile=${path.join(os.tmpdir(), 'campusbite-pinggy-known-hosts')}`, '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes', `-R0:localhost:${PORT}`, 'a.pinggy.io'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  children.push(ssh);
  let announced = false;
  const onData = (buf) => {
    // Tunnel links look like https://abcde-1-2-3-4.free.pinggy.net (not the dashboard.pinggy.io advert).
    const m = /https:\/\/(?!dashboard\.)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:pinggy\.net|pinggy\.link|pinggy-free\.link)/i.exec(buf.toString());
    if (m && !announced) {
      announced = true;
      announce(m[0], 'Pinggy, renews every 60 minutes');
    }
  };
  ssh.stdout.on('data', onData);
  ssh.stderr.on('data', onData);
  ssh.on('error', () => {
    console.error('Could not start ssh. On Windows, enable it in Settings → System → Optional features → OpenSSH Client.');
    stop(1);
  });
  ssh.on('exit', () => {
    if (!announced) {
      console.error('[tunnel] Pinggy did not connect. Check the internet connection, then run npm run share again.');
      stop(1);
    }
    console.log('[tunnel] Pinggy link expired. Opening a new link…');
    startPinggy();
  });
}

console.log('3/3 Opening a public HTTPS tunnel…');
const via = process.env.SHARE_VIA ?? 'auto'; // auto | cloudflare | pinggy
if (via === 'pinggy' || !(await tryCloudflare())) {
  if (via === 'cloudflare') {
    console.error('Cloudflare tunnel could not connect (this network blocks port 7844).');
    stop(1);
  }
  if (via === 'auto') console.log('   Cloudflare is blocked on this network; using Pinggy over port 443 instead…');
  startPinggy();
}
