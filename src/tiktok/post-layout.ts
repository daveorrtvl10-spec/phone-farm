export interface PickerLayout {
    circleX: number;
    columnStep: number;
    /** Circle y of the LAST row once the grid is scrolled to the bottom. */
    firstY: number;
    /** Same, after the selection tray appears and shifts the grid up. */
    trayY: number;
    rowStep: number;
    /** Circle y of the FIRST row when the grid sits at the top (short library). */
    topRowY?: number;
    /** Rows that fit above the bottom bar; past this the grid scrolls. */
    visibleRows?: number;
}

export interface PickerTarget {
    x: number;
    y: number;
}

export function recentPickerTargets(assetCount: number, count: number, layout: PickerLayout): PickerTarget[] {
    if (!Number.isSafeInteger(assetCount) || assetCount < count || count < 1) {
        throw new Error('Photos asset count cannot satisfy the requested media selection');
    }
    const latestIndex = assetCount - 1;
    // A library short enough to fit on one screen never scrolls: the grid stays
    // anchored at the TOP and the selection tray does not shift it. Using the
    // bottom-anchored numbers there taps empty space below the grid — seen live
    // 2026-09-03 with two photos, where the run sat on the picker pressing Next.
    const topRowY = layout.topRowY;
    if (topRowY !== undefined && layout.visibleRows !== undefined && Math.ceil(assetCount / 3) <= layout.visibleRows) {
        return Array.from({ length: count }, (_, selection) => {
            const assetIndex = latestIndex - selection;
            return {
                x: layout.circleX + ((assetIndex % 3) * layout.columnStep),
                y: topRowY + (Math.floor(assetIndex / 3) * layout.rowStep),
            };
        });
    }
    const latestRow = Math.floor(latestIndex / 3);
    return Array.from({ length: count }, (_, selection) => {
        const assetIndex = latestIndex - selection;
        const rowDifference = latestRow - Math.floor(assetIndex / 3);
        return {
            x: layout.circleX + ((assetIndex % 3) * layout.columnStep),
            y: selection === 0 ? layout.firstY : layout.trayY - (rowDifference * layout.rowStep),
        };
    });
}

export interface SingleCellLayout {
    cellX: number;
    cellStep: number;
    /** Thumbnail centre y of the LAST row once scrolled to the bottom. */
    cellY: number;
    /** Thumbnail centre y of the FIRST row when the grid sits at the top. */
    cellTopRowY?: number;
    rowStep: number;
    visibleRows?: number;
}

/** Where to tap the newest thumbnail (single-select), top- or bottom-anchored. */
export function newestCellTarget(assetCount: number, layout: SingleCellLayout): PickerTarget {
    if (!Number.isSafeInteger(assetCount) || assetCount < 1) {
        throw new Error('Photos asset count must be at least 1');
    }
    const latestIndex = assetCount - 1;
    const x = layout.cellX + ((latestIndex % 3) * layout.cellStep);
    const cellTopRowY = layout.cellTopRowY;
    if (cellTopRowY !== undefined && layout.visibleRows !== undefined && Math.ceil(assetCount / 3) <= layout.visibleRows) {
        return { x, y: cellTopRowY + (Math.floor(latestIndex / 3) * layout.rowStep) };
    }
    return { x, y: layout.cellY };
}
