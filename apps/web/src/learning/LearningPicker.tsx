/**
 * Phase 31 M5 (N): "who's playing?" in the maze, the lesson page's picker (Phase 31 M2) in the game's UI. It shows
 * only with two or more children on this device and none picked in this tab, while the maze builds, so a child
 * picks before the first gate. Picture-only: each child is their Pip avatar on a big button, chosen by tap, click,
 * Enter or Space (arrow keys move between them). The heading is for grown-ups and screen readers; a child needs no
 * reading. The button's accessible name is the nickname, which is spoken only by the browser's own voice.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { avatarSvg } from './avatars.ts';
import { useLearning } from './LearningGateCard.tsx';
import './learning.css';

export function LearningPicker() {
  const [learning, view] = useLearning();
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const picker = view.picker;
  // the first Pip takes focus, so Enter or Space picks straight away
  useEffect(() => {
    if (picker) list.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [picker]);
  if (!picker) return null;
  const move = (dir: -1 | 1) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(at + dir + buttons.length) % buttons.length]?.focus();
  };
  return (
    <div className="wwm-lpick" data-testid="learning-picker">
      <div className="wwm-lpick__frame">
        <section className="wwm-lpick__card" role="dialog" aria-modal="true" aria-labelledby="lpick-h">
          <h2 id="lpick-h" className="wwm-lpick__title">
            {t('learning.picker.title')}
          </h2>
          <div ref={list} className="wwm-lpick__choices">
            {picker.profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className="wwm-lpick__choice"
                aria-label={p.nickname}
                onClick={() => learning.pick(p.id)}
                onKeyDown={(e) => {
                  // arrows move between the Pips; Tab stays inside the dialog
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(1);
                  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(-1);
                  else if (e.key === 'Tab') move(e.shiftKey ? -1 : 1);
                  else return;
                  e.preventDefault();
                }}
                data-testid="learning-pick"
                data-avatar={p.avatar}
                // trusted renderer output: numbers, fixed colours and validated theme colours (avatars.ts)
                // biome-ignore lint/security/noDangerouslySetInnerHtml: avatarSvg writes no document text
                dangerouslySetInnerHTML={{ __html: avatarSvg(picker.theme, p.avatar, 112) }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
