/**
 * Host pairing UI for Phase 08's "Connect" screen: QR code for `https://<host>/c/<code>`, the 6-digit code
 * in big type, a copyable link, live "controller connected" state, and "Play with PC only".
 */
import { pairingUrl } from '@wwm/net';
import { useState } from 'react';
import { QrCode } from './QrCode.tsx';
import { strings } from './strings.ts';
import type { HostRoom } from './useHostRoom.ts';

export interface PairingPanelProps {
  room: HostRoom;
  /** Origin the phone should open (default `location.origin`). Use the public/tunnel URL in dev. */
  pairBase?: string;
  onPlayKeyboard?: () => void;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export function PairingPanel({ room, pairBase, onPlayKeyboard }: PairingPanelProps) {
  const t = strings();
  const [copied, setCopied] = useState(false);
  const base = pairBase ?? (typeof location === 'undefined' ? 'http://localhost' : location.origin);
  const link = room.code ? pairingUrl(base, room.code) : null;

  return (
    <section
      data-testid="pairing-panel"
      data-code={room.code ?? ''}
      data-connected={room.controllerConnected}
      style={{
        display: 'grid',
        gap: 16,
        justifyItems: 'center',
        padding: 24,
        borderRadius: 16,
        background: '#0b1020',
        color: '#e9f0ff',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 420,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>{t.connectTitle}</h2>
      {room.status === 'creating' && <p>{t.creatingRoom}</p>}
      {room.status === 'error' && (
        <>
          <p role="alert">{t.roomError}</p>
          <button type="button" onClick={room.retry}>
            {t.retry}
          </button>
        </>
      )}
      {room.status === 'ready' && room.code && link && (
        <>
          <p
            data-testid="pair-code"
            style={{
              margin: 0,
              fontSize: 56,
              fontWeight: 800,
              letterSpacing: '0.08em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatCode(room.code)}
          </p>
          <QrCode text={link} size={200} label={t.scanQr} />
          <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>{t.scanQr}</p>
          <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>{t.orOpen}</p>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <code data-testid="pair-link" style={{ fontSize: 14, wordBreak: 'break-all' }}>
              {link}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
          <p
            data-testid="pair-status"
            aria-live="polite"
            style={{ margin: 0, fontWeight: 700, color: room.controllerConnected ? '#5cf2c4' : '#ffd25c' }}
          >
            {room.controllerConnected ? t.connected : t.waitingPhone}
          </p>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.6 }}>{t.lockPortrait}</p>
        </>
      )}
      {onPlayKeyboard && (
        <button type="button" onClick={onPlayKeyboard} data-testid="play-keyboard">
          {t.playKeyboard}
        </button>
      )}
    </section>
  );
}
