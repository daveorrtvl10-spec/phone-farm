/** BlockerProbe backed by a raw WDA session, for tools that own the device. */
import {
    type UiSession,
    acceptAlertButton,
    alertButtons,
    alertText,
    clickElement,
    findElements,
} from './ui.js';
import type { BlockerProbe } from '../tiktok/blocker-probe.js';

export function wdaProbe(session: UiSession): BlockerProbe {
    return {
        alertText: () => alertText(session),
        alertButtons: () => alertButtons(session),
        pressAlertButton: (name) => acceptAlertButton(session, name),
        async buttons() {
            const found = await findElements(session, '**/XCUIElementTypeButton', 30);
            return found
                .filter((element) => element.label)
                .map((element) => ({
                    label: element.label,
                    press: () => clickElement(session, element.id),
                }));
        },
    };
}
