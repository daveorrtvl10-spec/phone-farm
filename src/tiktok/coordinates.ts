export interface Point { x: number; y: number }
export interface TikTokCoordinates {
    passcodeKeypad: { columnX: [number, number, number]; rowY: [number, number, number, number] };
    tiktok: {
        profileTab: Point; homeTab: Point; accountSwitcher: Point; create: Point; upload: Point;
        selectMultiple: Point; useLayout: Point;
        picker: { circleX: number; columnStep: number; firstY: number; trayY: number; rowStep: number; cellX: number; cellStep: number; cellY: number };
        pickerNext: Point; editorNext: Point; caption: Point; keyboardBack: Point; draft: Point; finish: Point;
        like: Point; save: Point; swipe: { x: number; startY: number; endY: number; durationMs: number };
    };
}

export const DEVICE_COORDINATES = {
    // Derived from iphone8 geometry, not measured — see src/devices/coordinates.ts. Keep in sync.
    iphoneXsMax: {
        passcodeKeypad: { columnX: [117, 207, 297], rowY: [290, 386, 482, 578] },
        tiktok: {
            profileTab: { x: 373, y: 851 }, homeTab: { x: 41, y: 848 }, accountSwitcher: { x: 207, y: 182 },
            create: { x: 207, y: 835 }, upload: { x: 33, y: 830 }, selectMultiple: { x: 24, y: 813 },
            useLayout: { x: 24, y: 684 },
            picker: { circleX: 119, columnStep: 138, firstY: 512, trayY: 384, rowStep: 138, cellX: 69, cellStep: 138, cellY: 557 },
            pickerNext: { x: 306, y: 812 }, editorNext: { x: 306, y: 832 }, caption: { x: 132, y: 260 },
            keyboardBack: { x: 22, y: 66 }, draft: { x: 108, y: 825 }, finish: { x: 306, y: 825 },
            like: { x: 384, y: 508 }, save: { x: 384, y: 639 }, swipe: { x: 207, startY: 700, endY: 250, durationMs: 450 },
        },
    },
    iphone8: {
        passcodeKeypad: { columnX: [103, 191, 275], rowY: [220, 347, 425, 506] },
        tiktok: {
            profileTab: { x: 338, y: 656 }, homeTab: { x: 38, y: 653 }, accountSwitcher: { x: 185, y: 158 },
            create: { x: 187, y: 640 }, upload: { x: 30, y: 635 }, selectMultiple: { x: 24, y: 618 },
            useLayout: { x: 24, y: 489 },
            picker: { circleX: 106, columnStep: 126, firstY: 482, trayY: 360, rowStep: 125, cellX: 62, cellStep: 125, cellY: 526 },
            pickerNext: { x: 277, y: 617 }, editorNext: { x: 277, y: 637 }, caption: { x: 120, y: 236 },
            keyboardBack: { x: 22, y: 42 }, draft: { x: 98, y: 630 }, finish: { x: 277, y: 630 },
            like: { x: 345, y: 313 }, save: { x: 345, y: 444 }, swipe: { x: 187, startY: 550, endY: 150, durationMs: 450 },
        },
    },
} satisfies Record<string, TikTokCoordinates>;

export type CoordinateProfile = keyof typeof DEVICE_COORDINATES;
export function coordinatesForProfile(profile = 'iphone8'): TikTokCoordinates {
    if (!(profile in DEVICE_COORDINATES)) throw new Error(`Unknown TikTok coordinate profile "${profile}"`);
    return DEVICE_COORDINATES[profile as CoordinateProfile];
}
