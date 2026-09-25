/** Phase 06 web exports for Phase 08: the controller page, host pairing UI and room hook. */
export { ControllerPage } from './ControllerPage.tsx';
export { formatCode, PairingPanel, type PairingPanelProps } from './PairingPanel.tsx';
export { QrCode } from './QrCode.tsx';
export { ControllerSession, type ControllerView, HAPTIC_PATTERNS } from './session.ts';
export { STRINGS, strings } from './strings.ts';
export { TiltIndicator } from './TiltIndicator.tsx';
export { type HostRoom, openHostRoom, type UseHostRoomOptions, useHostRoom } from './useHostRoom.ts';
