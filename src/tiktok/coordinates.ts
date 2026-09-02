export interface Point { x: number; y: number }
export interface TikTokCoordinates {
    passcodeKeypad: { columnX: [number, number, number]; rowY: [number, number, number, number] };
    tiktok: {
        profileTab: Point; homeTab: Point; accountSwitcher: Point; create: Point; upload: Point; uploadAlt?: Point;
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
            profileTab: { x: 361, y: 839 }, homeTab: { x: 40, y: 841 }, accountSwitcher: { x: 102, y: 121 },
            create: { x: 205, y: 834 }, upload: { x: 28, y: 830 }, uploadAlt: { x: 330, y: 725 }, selectMultiple: { x: 24, y: 836 },
            useLayout: { x: 24, y: 704 },
            picker: { circleX: 120, columnStep: 138, firstY: 683, trayY: 600, rowStep: 138, cellX: 69, cellStep: 138, cellY: 735 },
            pickerNext: { x: 295, y: 845 }, editorNext: { x: 299, y: 830 }, caption: { x: 200, y: 280 },
            keyboardBack: { x: 28, y: 62 }, draft: { x: 111, y: 830 }, finish: { x: 309, y: 826 },
            like: { x: 382, y: 470 }, save: { x: 383, y: 602 }, swipe: { x: 207, startY: 700, endY: 250, durationMs: 450 },
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
