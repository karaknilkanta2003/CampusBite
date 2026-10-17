// Starts the API server and the web dev server together (Windows, macOS and Linux).
// Ctrl+C stops both, including their child processes.
//   node scripts/dev.mjs         this computer only (http://localhost:5173)
//   node scripts/dev.mjs --lan   also phones and tablets on the same Wi-Fi
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

const isWindows = process.platform === 'win32';
const lan = process.argv.includes('--lan');

function start(workspace, extra = '') {
  // One command string (not an args array) so Windows' shell gets no unescaped arguments.
  return spawn(`npm run dev --workspace ${workspace}${extra}`, { stdio: 'inherit', shell: true });
}

const procs = [start('server'), start('web', lan ? ' -- --host' : '')];

if (lan) {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  setTimeout(() => {
    console.log('\nOpen CampusBite on other devices on the same network:');
    for (const ip of addresses) {
      console.log(`  Students:     http://${ip}:5173/`);
      console.log(`  Kitchen:      http://${ip}:5173/kitchen`);
      console.log(`  Pickup board: http://${ip}:5173/board/vc`);
    }
    console.log('If a device cannot connect, allow Node.js through the firewall (Private networks).\n');
  }, 4000);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    if (p.exitCode !== null || !p.pid) continue;
    if (isWindows) {
      // Killing the shell alone leaves npm, node and vite running; end the whole tree.
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      p.kill('SIGTERM');
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('SIGHUP', () => stop(0));
for (const p of procs) p.on('exit', (code) => code && stop(code));
