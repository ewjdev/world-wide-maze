/**
 * Service worker. The popup connects on a port named `wwm-popup`, sends `{type:'start', tabId, origin}`, and
 * receives `{type:'state', state}` updates. The job keeps running after the popup closes (it closes as soon as
 * the game tab takes focus).
 */
import { workerDeps } from './capture.ts';
import { extensionApi } from './chrome.ts';
import { JobRunner, type StartRequest } from './job.ts';

const api = extensionApi();
const runner = new JobRunner(api, workerDeps);

api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wwm-popup') return;
  const off = runner.subscribe((state) => {
    try {
      port.postMessage({ type: 'state', state });
    } catch {
      // popup closed
    }
  });
  port.onDisconnect.addListener(off);
  port.onMessage.addListener((m) => {
    const msg = m as { type?: string } & Partial<StartRequest>;
    if (msg.type === 'start' && typeof msg.tabId === 'number' && typeof msg.origin === 'string')
      void runner.start({ tabId: msg.tabId, origin: msg.origin });
  });
});

// Automation hooks (the e2e test reads the job the popup starts).
Object.assign(globalThis, {
  wwmStart: (r: StartRequest) => runner.start(r),
  wwmState: () => runner.state,
});
