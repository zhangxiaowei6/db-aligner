import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));

import { tauriBridge } from './tauri-bridge';

describe('Tauri desktop bridge', () => {
  beforeEach(() => {
    native.invoke.mockReset();
    native.listen.mockReset();
  });

  it('waits for event registration before announcing renderer readiness', async () => {
    let attached!: (stop: () => void) => void;
    const unlisten = vi.fn();
    const received = vi.fn();
    native.listen.mockReturnValue(new Promise((resolve) => (attached = resolve)));
    native.invoke.mockResolvedValue(undefined);

    const unsubscribe = tauriBridge.onEvent(received);
    tauriBridge.window('renderer-ready');
    expect(native.invoke).not.toHaveBeenCalled();

    attached(unlisten);
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith('dbaligner_window', {
        action: 'renderer-ready',
      }),
    );
    native.listen.mock.calls[0][1]({ payload: { event: 'job', id: '1' } });
    expect(received).toHaveBeenCalledWith({ event: 'job', id: '1' });
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('cleans up a listener that resolves after its subscriber unmounts', async () => {
    let attached!: (stop: () => void) => void;
    const unlisten = vi.fn();
    native.listen.mockReturnValue(new Promise((resolve) => (attached = resolve)));

    tauriBridge.onEvent(vi.fn())();
    attached(unlisten);
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalledOnce());
  });

  it('preserves an Error message when the host rejects a command with a string', async () => {
    native.invoke.mockRejectedValueOnce('engine unavailable');
    await expect(tauriBridge.invoke('ping')).rejects.toThrow('engine unavailable');
  });
});
