/**
 * Post the oldest ready folder for an account.
 *   node --import tsx scripts/post-next.mjs --account @x [--dry-run] [--allow-health-test]
 *
 * Whoever makes the slides just drops a folder in content/ready/<handle>/<slug>/
 * with numbered images and a post.json. This picks the oldest, checks every gate
 * (warm-up, health test, daily cap, golden window, phone free), posts it, then
 * moves the folder to content/posted/ and records it in the roster.
 */
import { readdir, readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { postingAllowed, validatePost } from '../src/planning/content.ts';

const API = process.env.FARM_API ?? 'http://127.0.0.1:3000';
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const root = new URL('..', import.meta.url).pathname;

const rosterPath = path.join(root, 'roster.json');
const roster = JSON.parse(await readFile(rosterPath, 'utf8'));
const tz = roster.tzOffsetHours ?? -5;
const handle = value('account', '');
const account = roster.accounts.find((a) => a.handle === handle);
if (!account) { console.error(`usage: --account <handle from roster.json>`); process.exit(1); }

const readyDir = path.join(root, 'content', 'ready', handle);
let folders = [];
try { folders = (await readdir(readyDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* none */ }
if (folders.length === 0) { console.log(`Nothing ready for ${handle} (drop a folder in content/ready/${handle}/).`); process.exit(0); }
const slug = folders[0];
const dir = path.join(readyDir, slug);

const files = (await readdir(dir)).filter((f) => f !== 'post.json' && !f.startsWith('.')).sort();
let manifest = {};
try { manifest = JSON.parse(await readFile(path.join(dir, 'post.json'), 'utf8')); }
catch { console.error(`${slug}: post.json is missing or unreadable`); process.exit(1); }

const validation = validatePost(files, manifest);
if (!validation.ok) { console.error(`${slug} is not postable:\n  - ${validation.errors.join('\n  - ')}`); process.exit(1); }

const postsToday = (account.posts ?? []).filter((p) =>
    new Date(Date.parse(p.postedAt) + tz * 3_600_000).toISOString().slice(0, 10)
    === new Date(Date.now() + tz * 3_600_000).toISOString().slice(0, 10)).length;
const gate = postingAllowed({ account, now: Date.now(), tzOffsetHours: tz, postsToday, allowHealthTest: flag('allow-health-test') });
console.log(`${handle} — ${slug}: ${files.length} slide(s), ${manifest.destination}`);
console.log(`gate: ${gate.ok ? 'clear' : `BLOCKED — ${gate.reason}`}`);
if (!gate.ok) process.exit(1);

const conn = await (await fetch(`${API}/api/devices/${account.device}/connection`)).json().catch(() => null);
if (!conn || conn.physical !== 'connected' || conn.wda !== 'ready') {
    console.error(`${account.deviceName} is not ready (${conn ? `${conn.physical}/${conn.wda}` : 'unreachable'}).`);
    process.exit(1);
}
const runs = await (await fetch(`${API}/api/executions?deviceUdid=${account.device}`)).json().catch(() => ({ executions: [] }));
const busy = (runs.executions ?? [])[0];
if (busy && ['running', 'queued'].includes(busy.status)) { console.error(`${account.deviceName} is busy (${busy.status}).`); process.exit(1); }

if (flag('dry-run')) { console.log('dry run — not posting.'); process.exit(0); }

const form = new FormData();
for (const file of files) {
    const bytes = await readFile(path.join(dir, file));
    form.append('media', new Blob([bytes], { type: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }), file);
}
form.append('destination', manifest.destination);
form.append('account', handle);
form.append('caption', manifest.caption);

const res = await fetch(`${API}/api/devices/${account.device}/posts`, { method: 'POST', headers: { origin: API }, body: form });
console.log(`submitted: ${res.status}`);
if (!res.ok) { console.error(await res.text()); process.exit(1); }

let final = 'unknown';
for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 10_000));
    const list = await (await fetch(`${API}/api/executions?deviceUdid=${account.device}`)).json().catch(() => null);
    const run = (list?.executions ?? []).find((e) => e.taskType === 'post');
    if (!run) continue;
    if (['succeeded', 'failed', 'stopped'].includes(run.status)) { final = run.status; break; }
}
console.log(`run finished: ${final}`);

const postedDir = path.join(root, 'content', 'posted', handle);
await mkdir(postedDir, { recursive: true });
await writeFile(path.join(dir, 'result.json'), JSON.stringify({ finishedAt: new Date().toISOString(), status: final, slides: files.length }, null, 2));
await rename(dir, path.join(postedDir, slug));

if (final === 'succeeded') {
    account.posts = account.posts ?? [];
    account.posts.push({
        postedAt: new Date().toISOString(),
        kind: flag('allow-health-test') ? 'health-test' : 'content',
        views24h: null, views48h: null,
        note: manifest.hypothesis ? `hypothesis: ${manifest.hypothesis}` : undefined,
    });
    await writeFile(rosterPath, `${JSON.stringify(roster, null, 2)}\n`);
    console.log('roster updated.');
}
