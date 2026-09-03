import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newestCellTarget, recentPickerTargets } from '../src/tiktok/post-layout.js';

// Measured iphoneXsMax picker (docs/WARMUP.md).
const XS = {
    circleX: 120, columnStep: 138, firstY: 683, trayY: 600, rowStep: 138,
    cellX: 69, cellStep: 138, cellY: 735, topRowY: 156, cellTopRowY: 208, visibleRows: 4,
};
// A profile whose top-anchored positions were never measured (e.g. iphone8).
const UNMEASURED = { circleX: 106, columnStep: 126, firstY: 482, trayY: 360, rowStep: 125, cellX: 62, cellStep: 125, cellY: 526 };

test('short library: the newest thumbnail is in the TOP row', () => {
    // The live failure on 2026-09-03: two photos, one row at the top. The old
    // bottom-anchored y (735) tapped empty space below the grid.
    assert.deepEqual(newestCellTarget(2, XS), { x: 207, y: 208 });
    assert.deepEqual(newestCellTarget(1, XS), { x: 69, y: 208 });
    assert.deepEqual(newestCellTarget(4, XS), { x: 69, y: 208 + 138 });
});

test('long library: still bottom-anchored after scrolling to the bottom', () => {
    // 13 assets = 5 rows > visibleRows, so the grid scrolls and the last row sits low.
    assert.deepEqual(newestCellTarget(13, XS), { x: 69, y: 735 });
});

test('unmeasured profile keeps the old bottom-anchored behaviour', () => {
    assert.deepEqual(newestCellTarget(2, UNMEASURED), { x: 62 + 125, y: 526 });
    const [first] = recentPickerTargets(2, 1, UNMEASURED);
    assert.equal(first?.y, 482);
});

test('short library, multi-select: every circle is top-anchored and unshifted', () => {
    const targets = recentPickerTargets(3, 3, XS);
    assert.deepEqual(targets, [
        { x: 396, y: 156 },
        { x: 258, y: 156 },
        { x: 120, y: 156 },
    ]);
});

test('long library, multi-select: newest first, tray shift applied to later picks', () => {
    const targets = recentPickerTargets(15, 2, XS);
    assert.equal(targets[0]?.y, 683, 'first pick uses the pre-tray row');
    assert.equal(targets[1]?.y, 600, 'later picks use the shifted row');
});

test('rejects an asset count that cannot satisfy the selection', () => {
    assert.throws(() => recentPickerTargets(1, 3, XS), /cannot satisfy/);
    assert.throws(() => newestCellTarget(0, XS), /at least 1/);
});
