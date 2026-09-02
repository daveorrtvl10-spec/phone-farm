import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { awaitAssist, readAssist, resolveAssist } from '../src/tiktok/assist.js';

test('awaitAssist blocks until resumed, then clears the request', async () => {
    process.env.SCHEDULER_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'assist-'));
    const udid = 'TEST-UDID';
    let polls = 0;
    const pause = async () => {
        polls += 1;
        if (polls === 2) {
            const open = await readAssist(udid);
            assert.equal(open?.state, 'waiting');
            assert.equal(open?.step, 'picker');
            await resolveAssist(udid, 'resume', 'tapped X');
        }
    };
    const result = await awaitAssist({ udid, step: 'picker', reason: 'unknown screen' }, { pause, timeoutMs: 60_000 });
    assert.equal(result.state, 'resume');
    assert.equal(result.note, 'tapped X');
    assert.equal(await readAssist(udid), undefined);
});

test('awaitAssist throws on abort and on timeout', async () => {
    process.env.SCHEDULER_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'assist-'));
    const udid = 'TEST-UDID-2';
    await assert.rejects(
        awaitAssist({ udid, step: 'form', reason: 'x' }, { pause: async () => { await resolveAssist(udid, 'abort'); }, timeoutMs: 60_000 }),
        /Aborted by operator/,
    );
    await assert.rejects(
        awaitAssist({ udid, step: 'form', reason: 'x' }, { pause: async () => {}, timeoutMs: 1 }),
        /No operator resumed/,
    );
    assert.equal(await readAssist(udid), undefined);
});

test('resolveAssist ignores requests that are not waiting', async () => {
    process.env.SCHEDULER_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'assist-'));
    assert.equal(await resolveAssist('nobody', 'resume'), undefined);
});
