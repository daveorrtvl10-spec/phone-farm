export interface PickerLayout {
    circleX: number;
    columnStep: number;
    firstY: number;
    trayY: number;
    rowStep: number;
    /**
     * Grid order. Legacy TikTok pickers list oldest-first with the newest
     * asset in the last row (default). Current TikTok "Recents" lists
     * newest-first, so the newest asset is always cell 0 (top-left) and
     * older assets run left-to-right, top-to-bottom.
     */
    newestFirst?: boolean;
}

export interface PickerTarget {
    x: number;
    y: number;
}

export function recentPickerTargets(assetCount: number, count: number, layout: PickerLayout): PickerTarget[] {
    if (!Number.isSafeInteger(assetCount) || assetCount < count || count < 1) {
        throw new Error('Photos asset count cannot satisfy the requested media selection');
    }
    if (layout.newestFirst) {
        return Array.from({ length: count }, (_, selection) => ({
            x: layout.circleX + ((selection % 3) * layout.columnStep),
            y: (selection === 0 ? layout.firstY : layout.trayY) + (Math.floor(selection / 3) * layout.rowStep),
        }));
    }
    const latestIndex = assetCount - 1;
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
