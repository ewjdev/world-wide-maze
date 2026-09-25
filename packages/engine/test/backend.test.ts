import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  markWarned,
  markWebGPUFailed,
  quietErrorScopes,
  resetBackendState,
  wantWebGPU,
} from '../src/backend.ts';

describe('backend choice and the WebGPU → WebGL2 fallback', () => {
  afterEach(() => {
    resetBackendState();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('WebGPU is tried only where navigator.gpu exists and nothing forces WebGL2', () => {
    vi.stubGlobal('navigator', {});
    expect(wantWebGPU(false)).toBe(false); // a browser without WebGPU: WebGL2, quietly
    vi.stubGlobal('navigator', { gpu: {} });
    expect(wantWebGPU(undefined)).toBe(true);
    expect(wantWebGPU(true)).toBe(false);
  });

  test('after a failure, later engines skip WebGPU; the warning is logged once per page', () => {
    vi.stubGlobal('navigator', { gpu: {} });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    markWebGPUFailed('WebGPU device lost (unknown: gone); continuing on WebGL2.');
    markWebGPUFailed('WebGPU device lost again');
    expect(wantWebGPU(false)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('[@wwm/engine] WebGPU device lost');
    expect(error).not.toHaveBeenCalled();
  });

  test("three's own startup fallback warning counts as the one warning", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    markWebGPUFailed(null);
    markWarned();
    markWebGPUFailed('WebGPU device lost');
    expect(warn).not.toHaveBeenCalled();
  });

  test('popErrorScope rejections after a device loss become "no error" instead of unhandled rejections', async () => {
    let lost = false;
    const device = {
      popErrorScope: vi.fn(() =>
        lost
          ? Promise.reject(new Error('Instance dropped in popErrorScope'))
          : Promise.resolve({ message: 'x' }),
      ),
    };
    quietErrorScopes(device);
    await expect(device.popErrorScope()).resolves.toEqual({ message: 'x' }); // real errors still come through
    lost = true;
    await expect(device.popErrorScope()).resolves.toBeNull();
  });
});
