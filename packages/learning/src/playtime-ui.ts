import { authorizePlaytime, checkpointPlaytime, playtimeView, stopPlaytime } from './playtime.ts';
import './playtime.css';

/** One native dialog provides focus containment and makes the underlying game inert while stopped. */
export function mountPlaytime(): void {
  if (document.getElementById('family-playtime')) return;
  const root = document.createElement('aside');
  root.id = 'family-playtime';
  root.innerHTML = `<div class="pt-bar"><button type="button" data-pt="settings">Grown-ups: playtime</button><span role="status" class="pt-status"></span><button type="button" data-pt="stop" hidden>All done</button></div>
  <dialog class="pt-dialog" aria-labelledby="pt-title"><div class="pt-content"></div></dialog>`;
  document.body.append(root);
  const dialog = root.querySelector('dialog') as HTMLDialogElement;
  const content = root.querySelector('.pt-content') as HTMLElement;
  const status = root.querySelector('.pt-status') as HTMLElement;
  const stop = root.querySelector('[data-pt="stop"]') as HTMLButtonElement;
  let settings = false;
  let lastPhase = '';
  let attempts = 0;
  let retryAt = 0;
  function speak(text: string): void {
    try {
      if (
        !('speechSynthesis' in window) ||
        localStorage.getItem('wwm-learning.muted') === '1' ||
        localStorage.getItem('wwm.muted') === '1'
      )
        return;
      window.speechSynthesis.cancel();
      const line = new SpeechSynthesisUtterance(text);
      line.lang = 'en-US';
      line.rate = 0.85;
      window.speechSynthesis.speak(line);
    } catch {
      /* Visible directions remain available if device speech is unavailable. */
    }
  }
  const escapeText = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
    );
  function render(): void {
    const { phase, record } = playtimeView();
    document.documentElement.dataset.playtimeSetup = String(settings);
    document.documentElement.dataset.playtime = phase;
    status.textContent =
      phase === 'closing'
        ? 'Pip is getting ready to rest. Your work counts.'
        : phase === 'playing'
          ? 'A little adventure, then a break.'
          : '';
    stop.hidden = !['playing', 'closing'].includes(phase);
    if (phase === lastPhase && !settings) return;
    const changed = lastPhase !== phase;
    lastPhase = phase;
    if (changed && (phase === 'closing' || phase === 'finished')) {
      setTimeout(
        () =>
          speak(
            phase === 'closing'
              ? 'Pip is getting ready to rest. We can finish here. Your work counts.'
              : 'Our playtime is finished. You took time to explore with Pip. Look around. Can you spot a triangle?',
          ),
        100,
      );
    }
    // Timer ticks must not replace a caregiver's in-progress form or focused control.
    if (settings && dialog.open && content.querySelector('form')) return;
    if (settings) {
      content.innerHTML = `<h2 id="pt-title">A little time to play</h2><p>Choose the whole session, including a quiet final minute. The clock keeps going through lessons, maze play and pauses.</p><form><label>Playtime<select name="minutes"><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></label><label>${record ? 'Caregiver PIN' : 'Create a caregiver PIN'}<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="off"></label>${record ? '' : '<label>Repeat your PIN<input name="confirm" type="password" inputmode="numeric" required autocomplete="off"></label>'}<p class="pt-error" role="alert"></p><button type="submit">Start a new session</button><button type="button" data-pt="cancel">Cancel</button></form><p class="pt-note">For this browser on this site. Choose a PIN your child does not know. Clearing browser storage removes this local control. Keep your PIN private when setting up.</p>`;
      const form = content.querySelector('form') as HTMLFormElement;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const error = content.querySelector('.pt-error') as HTMLElement;
        const submit = form.querySelector('[type="submit"]') as HTMLButtonElement;
        const data = new FormData(form);
        if (Date.now() < retryAt) {
          error.textContent = 'Please wait a moment before trying again.';
          return;
        }
        if (!record && data.get('pin') !== data.get('confirm')) {
          error.textContent = 'The PINs need to match.';
          return;
        }
        submit.disabled = true;
        try {
          await authorizePlaytime(String(data.get('pin')), Number(data.get('minutes')));
          settings = false;
          dialog.close();
          lastPhase = '';
          render();
        } catch (e) {
          attempts++;
          if (attempts >= 3) retryAt = Date.now() + 30000;
          error.textContent =
            e instanceof Error ? e.message : 'Playtime could not be saved. Please check browser storage.';
        } finally {
          submit.disabled = false;
        }
      });
    } else if (phase === 'finished' || phase === 'unavailable') {
      const accomplishments = record?.accomplishments ?? [];
      content.innerHTML = `<h2 id="pt-title">${phase === 'unavailable' ? 'Let’s ask a grown-up' : 'Your adventure can rest'}</h2><p>${phase === 'unavailable' ? 'Playtime settings could not be read. Your grown-up can help check this browser.' : accomplishments.length ? 'Here is what you worked on today.' : 'You took time to explore with Pip. It’s time for a break.'}</p>${accomplishments.length ? `<ul>${accomplishments.map((x) => `<li>${escapeText(x)}</li>`).join('')}</ul>` : ''}<p class="pt-offline">Look around. Can you spot a triangle?</p><p>Your playtime is finished. You can put the screen away.</p><button type="button" data-pt="hear">Hear Pip</button><button type="button" data-pt="settings">Grown-ups: new session</button>`;
    } else {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }
  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-pt]')?.dataset.pt;
    if (action === 'hear')
      speak(
        'Our playtime is finished. You took time to explore with Pip. Look around. Can you spot a triangle?',
      );
    if (action === 'settings') {
      settings = true;
      render();
    }
    if (action === 'cancel') {
      settings = false;
      lastPhase = '';
      dialog.close();
      render();
    }
    if (action === 'stop') {
      try {
        stopPlaytime();
      } catch {
        lastPhase = '';
        render();
      }
    }
  });
  dialog.addEventListener('cancel', (event) => {
    if (settings) {
      settings = false;
      lastPhase = '';
      setTimeout(render, 0);
    } else event.preventDefault();
  });
  window.addEventListener('storage', () => {
    settings = false;
    lastPhase = '';
    render();
  });
  window.addEventListener('wwm-playtime', () => {
    if (!settings) render();
  });
  const check = () => {
    try {
      checkpointPlaytime();
    } catch {
      /* read state remains blocked if storage is unavailable */
    }
    render();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  setInterval(check, 1000);
  render();
}
