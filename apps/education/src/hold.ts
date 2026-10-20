/**
 * The grown-up gate (Phase 22's press-and-hold, from the game's `HoldButton`): a control that acts only after a
 * 2-second press, so a child tapping around doesn't open the parent area or switch who's playing. On a keyboard,
 * hold G anywhere (as in the game), or hold Space or Enter on the focused button. The fill shows the hold.
 */
export const HOLD_MS = 2000;

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The button's markup. Its accessible name starts with the visible label, then the visible instruction. */
export function holdButtonHtml(id: string, label: string, className = ''): string {
  return `<button type="button" class="hold-button ${attr(className)}" id="${attr(id)}" style="--hold-ms:${HOLD_MS}ms"><span class="hold-fill" aria-hidden="true"></span><span class="hold-label">${attr(label)}</span><span class="hold-hint">Press and hold for 2 seconds (or hold G)</span></button>`;
}

/** Wire a hold button. Returns a function that removes the listeners. */
export function holdToActivate(
  button: HTMLButtonElement,
  onDone: () => void,
  options: { ms?: number; holdKey?: string | null } = {},
): () => void {
  const ms = options.ms ?? HOLD_MS;
  const holdKey = options.holdKey === undefined ? 'KeyG' : options.holdKey;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    button.classList.remove('is-holding');
  };
  const start = () => {
    if (timer || button.hidden || button.disabled) return;
    button.classList.add('is-holding');
    timer = setTimeout(() => {
      timer = null;
      button.classList.remove('is-holding');
      onDone();
    }, ms);
  };

  const pointerDown = (event: PointerEvent) => {
    button.setPointerCapture?.(event.pointerId);
    start();
  };
  const ownKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';
  const buttonDown = (event: KeyboardEvent) => {
    if (!ownKey(event)) return;
    // a held key on the button is the gate, never a click
    event.preventDefault();
    if (!event.repeat) start();
  };
  const buttonUp = (event: KeyboardEvent) => {
    if (!ownKey(event)) return;
    event.preventDefault();
    cancel();
  };
  const down = (event: KeyboardEvent) => {
    if (!holdKey || event.code !== holdKey || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    start();
  };
  const up = (event: KeyboardEvent) => {
    if (holdKey && event.code === holdKey) cancel();
  };
  const menu = (event: Event) => event.preventDefault();

  button.addEventListener('pointerdown', pointerDown);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('lostpointercapture', cancel);
  button.addEventListener('contextmenu', menu);
  button.addEventListener('keydown', buttonDown);
  button.addEventListener('keyup', buttonUp);
  button.addEventListener('blur', cancel);
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', cancel);
  return () => {
    cancel();
    button.removeEventListener('pointerdown', pointerDown);
    button.removeEventListener('pointerup', cancel);
    button.removeEventListener('pointercancel', cancel);
    button.removeEventListener('lostpointercapture', cancel);
    button.removeEventListener('contextmenu', menu);
    button.removeEventListener('keydown', buttonDown);
    button.removeEventListener('keyup', buttonUp);
    button.removeEventListener('blur', cancel);
    removeEventListener('keydown', down);
    removeEventListener('keyup', up);
    removeEventListener('blur', cancel);
  };
}
