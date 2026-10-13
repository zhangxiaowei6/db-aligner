import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Updates, newerStable } from '../electron/updates';
import { UpdateInstallGate } from '../electron/update-install';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(enabled = true) {
  const port = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => {
      port.emit('update-available', { version: '0.2.0' });
    }),
    downloadUpdate: vi.fn(async () => {
      port.emit('update-downloaded', { version: '0.2.0' });
    }),
  });
  const emit = vi.fn();
  const install = vi.fn(async () => {});
  const updates = new Updates(port, '0.1.0', enabled, emit, install);
  return { port, emit, install, updates };
}

describe('update flow', () => {
  it('accepts only newer stable versions, including numeric rather than lexical ordering', () => {
    expect(newerStable('0.10.0', '0.9.0')).toBe(true);
    for (const candidate of ['0.1.0', '0.0.9', '0.2.0-beta.1', '01.2.0', 'v0.2.0'])
      expect(newerStable(candidate, '0.1.0')).toBe(false);
  });
  it('disabled modes do not access the network', async () => {
    const f = fixture(false);
    expect((await f.updates.check()).status).toBe('disabled');
    expect(f.port.checkForUpdates).not.toHaveBeenCalled();
    await expect(f.updates.download()).rejects.toThrow();
  });
  it('does not download until requested and coalesces checks and downloads', async () => {
    const f = fixture();
    await Promise.all([f.updates.check(), f.updates.check()]);
    expect(f.port.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(f.port.downloadUpdate).not.toHaveBeenCalled();
    expect(f.updates.get().status).toBe('available');
    await Promise.all([f.updates.download(), f.updates.download()]);
    expect(f.port.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(f.updates.get().status).toBe('downloaded');
    await f.updates.install();
    expect(f.install).toHaveBeenCalledTimes(1);
    await expect(f.updates.install()).rejects.toThrow();
  });
  it('rejects prereleases and downgrades even when provided by the server', async () => {
    const f = fixture();
    f.port.checkForUpdates.mockImplementation(async () => {
      f.port.emit('update-available', { version: '0.2.0-beta.1' });
    });
    expect((await f.updates.check()).status).toBe('current');
    await expect(f.updates.download()).rejects.toThrow();
  });
  it('network and checksum failures can be retried and never permit installation', async () => {
    const f = fixture();
    f.port.checkForUpdates.mockRejectedValueOnce(new Error('sensitive URL or token'));
    expect((await f.updates.check()).status).toBe('error');
    expect(f.updates.get().message).not.toContain('sensitive');
    await f.updates.check();
    f.port.downloadUpdate.mockRejectedValueOnce(new Error('checksum mismatch'));
    expect((await f.updates.download()).status).toBe('error');
    await expect(f.updates.install()).rejects.toThrow();
    expect(f.install).not.toHaveBeenCalled();
    await f.updates.check();
    await f.updates.download();
    expect(f.updates.get().status).toBe('downloaded');
  });
  it('ignores late progress and preserves a downloaded update after a busy-engine refusal', async () => {
    const f = fixture();
    await f.updates.check();
    await f.updates.download();
    f.port.emit('download-progress', { percent: 40 });
    expect(f.updates.get().percent).toBe(100);
    f.install.mockRejectedValueOnce(new Error('仍有比较任务'));
    await expect(f.updates.install()).rejects.toThrow('仍有比较任务');
    expect(f.updates.get().status).toBe('downloaded');
    await f.updates.install();
    expect(f.emit.mock.calls.map(([state]) => state.revision)).toEqual(
      [...f.emit.mock.calls.map(([state]) => state.revision)].sort((a, b) => a - b),
    );
  });
});

describe('update installation admission', () => {
  function steps() {
    return {
      prepare: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      launch: vi.fn(),
      recover: vi.fn(async () => {}),
    };
  }
  it('refuses pending business requests without stopping or launching an installer', async () => {
    const gate = new UpdateInstallGate();
    const pending = deferred();
    const s = steps();
    const request = gate.request(() => pending.promise);
    await expect(gate.install(s)).rejects.toThrow('仍有请求');
    expect(s.stop).not.toHaveBeenCalled();
    expect(s.launch).not.toHaveBeenCalled();
    pending.resolve();
    await request;
    await gate.install(s);
    expect(s.launch).toHaveBeenCalledTimes(1);
  });
  it('freezes admission before engine preparation and rejects concurrent install', async () => {
    const gate = new UpdateInstallGate();
    const pending = deferred();
    const s = steps();
    s.prepare.mockImplementation(() => pending.promise);
    const install = gate.install(s);
    await expect(gate.request(async () => {})).rejects.toThrow('正在准备更新');
    await expect(gate.install(s)).rejects.toThrow('已经');
    pending.resolve();
    await install;
    expect(s.prepare.mock.invocationCallOrder[0]).toBeLessThan(s.stop.mock.invocationCallOrder[0]);
    expect(s.stop.mock.invocationCallOrder[0]).toBeLessThan(s.launch.mock.invocationCallOrder[0]);
  });
  it('unknown timeout results block updates until a new engine confirms readiness', async () => {
    const gate = new UpdateInstallGate();
    const s = steps();
    gate.uncertain();
    await expect(gate.install(s)).rejects.toThrow('结果尚未确认');
    expect(s.prepare).not.toHaveBeenCalled();
    gate.engineStarted();
    await gate.install(s);
    expect(s.launch).toHaveBeenCalledTimes(1);
  });
  it('failed shutdown recovers admission, while failed recovery keeps it frozen', async () => {
    const gate = new UpdateInstallGate();
    const s = steps();
    s.stop.mockRejectedValueOnce(new Error('exit failure'));
    await expect(gate.install(s)).rejects.toThrow('exit failure');
    expect(s.launch).not.toHaveBeenCalled();
    await gate.request(async () => {});
    s.prepare.mockRejectedValueOnce(new Error('engine failure'));
    s.recover.mockRejectedValueOnce(new Error('cannot resume'));
    await expect(gate.install(s)).rejects.toThrow('无法恢复引擎');
    await expect(gate.request(async () => {})).rejects.toThrow('正在准备更新');
  });
});
