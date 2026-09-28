/** Loaded only by device-server's explicitly instrumented local HTML. */
import { FRAME_COLUMNS, numericLog, RAF_COLUMNS, summarizeDevice } from './device-data.mjs';

const configuration = sessionStorage.getItem('wwm.device.capture');
if (configuration) install(JSON.parse(configuration));
function install(metadata) {
  let report = null,
    running = false,
    start = 0,
    lastRaf = null,
    lastEngine = null;
  let engineLog,
    browserLog,
    raf = 0,
    timer = 0,
    binding = null,
    observer = null;
  const provenancePromise = fetch('/__device/provenance', { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('Build provenance unavailable');
    return r.json();
  });
  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Local device capture');
  Object.assign(panel.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    zIndex: '2147483647',
    background: '#12251fee',
    color: 'white',
    font: '13px system-ui',
    padding: '8px',
    borderRadius: '6px',
    maxWidth: '210px',
  });
  panel.innerHTML =
    '<span data-status>Device capture ready</span><div><button data-start>Start</button> <button data-stop disabled>Stop</button> <button data-export disabled>Export JSON</button></div><details><summary>End conditions</summary><label>Battery end <input data-battery size="8"></label><label>Thermal observation <input data-thermal size="16"></label></details>';
  document.body.append(panel);
  const status = panel.querySelector('[data-status]'),
    startButton = panel.querySelector('[data-start]'),
    stopButton = panel.querySelector('[data-stop]'),
    exportButton = panel.querySelector('[data-export]');
  const at = () => performance.now() - start;
  const visibility = () => {
    if (running) {
      report.visibility.push({ atMs: at(), state: document.visibilityState });
      lastRaf = null;
      lastEngine = null;
      snapshot();
    }
  };
  function unbind() {
    if (binding) {
      if (binding.engine.frame === binding.wrapped) binding.engine.frame = binding.original;
      binding = null;
    }
  }
  function bind() {
    const engine = window.__wwmGame?.engine;
    if (engine === binding?.engine) return;
    unbind();
    lastEngine = null;
    if (!engine) return;
    const original = engine.frame;
    const wrapped = function (...args) {
      const begin = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        if (running) {
          const t = begin - start;
          const interval = lastEngine === null ? -1 : t - lastEngine;
          lastEngine = t;
          if (!engineLog.append([t, interval, args[0], args[1] ?? -1, performance.now() - begin]))
            stop('sample-limit');
        }
      }
    };
    binding = { engine, original, wrapped };
    engine.frame = wrapped;
    report.bindings.push({ atMs: at(), event: 'engine-attached' });
  }
  function snapshot() {
    if (!running) return;
    try {
      const g = window.__wwmGame,
        e = g?.engine,
        r = e?.debug?.().renderer,
        s = e?.stats?.(),
        v = g?.getView?.();
      const c = window.__wwmController?.diag?.();
      const numbers = (value) =>
        value
          ? Object.fromEntries(
              Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)),
            )
          : null;
      const heap = performance.memory?.usedJSHeapSize;
      report.snapshots.push({
        atMs: at(),
        visibility: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        game: s
          ? {
              phase: v?.phase ?? null,
              stageId: g.debugState().stageId,
              backend: s.backend,
              tier: s.tier,
              qualityStatus: s.qualityStatus,
              drawCalls: s.drawCalls,
              tierLog: s.tierLog,
              canvas: { width: r.domElement.width, height: r.domElement.height },
            }
          : null,
        rendererMemory: numbers(r?.info?.memory),
        jsHeapUsedBytes: Number.isFinite(heap) ? heap : null,
        controller: c
          ? {
              screen: c.screen,
              permission: c.permission,
              connection: c.connection,
              hostConnected: c.hostConnected,
              rtt: c.rtt,
              send: c.send,
              sensor: c.sensor,
              framesSent: c.framesSent,
              framesSkipped: c.framesSkipped,
            }
          : null,
      });
    } catch (error) {
      recordError(`Snapshot: ${error.message}`);
    }
  }
  function tick(t) {
    if (!running) return;
    bind();
    const time = Math.max(0, t - start);
    if (
      !browserLog.append([
        time,
        lastRaf === null ? -1 : time - lastRaf,
        document.visibilityState === 'visible' ? 1 : 0,
      ])
    ) {
      stop('sample-limit');
      return;
    }
    lastRaf = time;
    if (time >= metadata.durationSeconds * 1000) {
      stop('duration');
      return;
    }
    raf = requestAnimationFrame(tick);
  }
  function recordError(message) {
    if (!running) return;
    if (report.errors.length >= 1000) {
      stop('sample-limit');
      return;
    }
    report.errors.push({ atMs: at(), message });
  }
  const error = (event) => recordError(event.message ?? String(event.reason));
  async function begin() {
    if (running) return;
    startButton.disabled = true;
    try {
      if (!(metadata.durationSeconds >= 5 && metadata.durationSeconds <= 1800))
        throw new Error('Duration must be 5–1800 seconds');
      const provenance = await provenancePromise;
      report = {
        schemaVersion: 1,
        metadata: { ...metadata },
        provenance,
        startedAt: new Date().toISOString(),
        elapsedMs: 0,
        truncated: false,
        environment: {
          userAgent: navigator.userAgent,
          webdriver: navigator.webdriver ?? false,
          language: navigator.language,
          secureContext: isSecureContext,
          viewport: { width: innerWidth, height: innerHeight },
          dpr: devicePixelRatio,
          hardwareConcurrency: navigator.hardwareConcurrency ?? null,
          deviceMemoryGiB: navigator.deviceMemory ?? null,
          path: location.pathname.replace(/^\/c\/[^/]+/, '/c/:room'),
        },
        instrumentation: {
          optIn: true,
          engineColumns: FRAME_COLUMNS,
          browserColumns: RAF_COLUMNS,
          unavailableSentinel: -1,
          resourceIntervalMs: 1000,
          sampleLimitPerStream: 240000,
          frameStorage: 'chunked Float64Array; JSON serialization only after stop',
          longTasksSupported:
            globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask') ?? false,
        },
        unavailable: {
          cpuUtilization: null,
          gpuUtilization: null,
          inputToPhotonMs: null,
          workerMemoryBytes: null,
          gpuTimestampMs: null,
        },
        visibility: [],
        bindings: [],
        snapshots: [],
        longTasks: null,
        errors: [],
        engineFrames: [],
        browserFrames: [],
      };
      engineLog = numericLog(5);
      browserLog = numericLog(3);
      start = performance.now();
      lastRaf = lastEngine = null;
      running = true;
      if (report.instrumentation.longTasksSupported) {
        report.longTasks = [];
        observer = new PerformanceObserver((list) => {
          if (running)
            for (const x of list.getEntries())
              if (x.startTime >= start) {
                if (report.longTasks.length >= 10000) {
                  stop('sample-limit');
                  break;
                }
                report.longTasks.push({ atMs: x.startTime - start, durationMs: x.duration });
              }
        });
        observer.observe({ type: 'longtask' });
      }
      document.addEventListener('visibilitychange', visibility);
      addEventListener('error', error);
      addEventListener('unhandledrejection', error);
      report.visibility.push({ atMs: 0, state: document.visibilityState });
      bind();
      snapshot();
      raf = requestAnimationFrame(tick);
      timer = setInterval(() => {
        snapshot();
        if (at() >= metadata.durationSeconds * 1000) stop('duration');
      }, 1000);
      status.textContent = 'Recording locally';
      stopButton.disabled = false;
      exportButton.disabled = true;
    } catch (error) {
      if (running) stop('initialization-error');
      status.textContent = error.message;
      startButton.disabled = false;
    }
  }
  function stop(reason = 'manual') {
    if (!running) return;
    if (report.errors.length < 1000) snapshot();
    report.elapsedMs = at();
    report.stoppedAt = new Date().toISOString();
    report.stopReason = reason;
    report.truncated = reason === 'sample-limit';
    running = false;
    cancelAnimationFrame(raf);
    clearInterval(timer);
    unbind();
    observer?.disconnect();
    observer = null;
    document.removeEventListener('visibilitychange', visibility);
    removeEventListener('error', error);
    removeEventListener('unhandledrejection', error);
    report.engineFrames = engineLog.export();
    report.browserFrames = browserLog.export();
    report.trends = summarizeDevice(report);
    status.textContent = `Stopped (${Math.round(report.elapsedMs / 1000)} s)`;
    stopButton.disabled = true;
    exportButton.disabled = false;
    startButton.disabled = false;
  }
  startButton.addEventListener('click', begin);
  stopButton.addEventListener('click', () => stop());
  exportButton.addEventListener('click', () => {
    if (!report || running) return;
    report.metadata.batteryEnd = panel.querySelector('[data-battery]').value;
    report.metadata.thermalObservation = panel.querySelector('[data-thermal]').value;
    const blob = new Blob([JSON.stringify(report)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `wwm-device-${report.startedAt.replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  // Local automation can inspect collector output without mutating gameplay or claiming physical evidence.
  window.__wwmDeviceCapture = { start: begin, stop, report: () => report };
}
