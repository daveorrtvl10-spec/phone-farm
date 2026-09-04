/**
 * Everything the farm should do the moment the Mac comes back.
 *   node --import tsx scripts/on-wake.mjs [--dry-run]
 *
 * Idempotent and safe to call repeatedly — the watcher fires it on every
 * reconnect. It installs the caffeinate agent (so the Mac stops sleeping in the
 * first place), re-runs sessions lost to the outage, and books the rest of the
 * day if the outage wiped it.
 */
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const SSH = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=8', '-p', '2222', 'josh-roberts@127.0.0.1'];
const dryRun = process.argv.includes('--dry-run');
const here = new URL('.', import.meta.url).pathname;
const roster = JSON.parse(await readFile(new URL('../roster.json', import.meta.url), 'utf8'));
const tz = roster.tzOffsetHours ?? -5;

const sh = (cmd, args) => new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => resolve({ code: code ?? 1, out: out.trim() }));
    child.on('error', () => resolve({ code: 1, out: 'spawn failed' }));
});
const runScript = (script, args = []) => new Promise((resolve) => {
    const child = spawn('node', ['--import', 'tsx', `${here}${script}`, ...args], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
});

const reachable = await (async () => {
    try { return (await fetch(`${API}/health`, { signal: AbortSignal.timeout(6000) })).ok; } catch { return false; }
})();
if (!reachable) { console.log('on-wake: dashboard still unreachable, nothing to do.'); process.exit(0); }

// 1. Stop the Mac sleeping again. Without this every overnight schedule is lost.
const loaded = await sh('ssh', [...SSH, 'launchctl list | grep -c com.phonefarm.caffeinate || true']);
if (loaded.out.trim() === '0' || loaded.code !== 0) {
    console.log('on-wake: installing the caffeinate agent');
    if (!dryRun) {
        const install = await sh('ssh', [...SSH,
            'cd ~/phone-farm && git pull -q && mkdir -p logs && sed "s|__HOME__|$HOME|g" mac/launchd/com.phonefarm.caffeinate.plist > ~/Library/LaunchAgents/com.phonefarm.caffeinate.plist && launchctl bootout gui/$(id -u)/com.phonefarm.caffeinate 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.phonefarm.caffeinate.plist && launchctl list | grep caffeinate']);
        console.log(`  ${install.out.split('\n').pop()}`);
    }
} else {
    console.log('on-wake: caffeinate already running');
}

// 2. Re-run what the outage cost us, inside the window only.
console.log('on-wake: recovering missed sessions');
await runScript('recover-missed.mjs', dryRun ? ['--dry-run'] : []);

// 3. If the outage left today with nothing booked, book what is left of it.
const today = new Date(Date.now() + tz * 3_600_000).toISOString().slice(0, 10);
let activeToday = 0;
try {
    const res = await fetch(`${API}/api/schedules`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    activeToday = (json.schedules ?? json).filter((s) => s.status === 'active'
        && new Date(Date.parse(s.nextRunAt) + tz * 3_600_000).toISOString().slice(0, 10) === today).length;
} catch { /* leave at 0 */ }
if (activeToday === 0) {
    console.log(`on-wake: nothing booked for ${today}, planning the rest of the day`);
    await runScript('plan-day.mjs', ['--date', today, ...(dryRun ? ['--dry-run'] : [])]);
} else {
    console.log(`on-wake: ${activeToday} session(s) already booked for ${today}`);
}
console.log('on-wake: done.');
