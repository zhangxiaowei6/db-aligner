// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateProvider, UpdateSection } from './updates';
import type { UpdateState } from './types';
const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('./api', () => ({
  api: bridge.invoke,
  onEvent: (fn: (event: Record<string, unknown>) => void) => {
    bridge.listeners.add(fn);
    return () => bridge.listeners.delete(fn);
  },
}));
const initial: UpdateState = {
  version: '0.1.0',
  enabled: true,
  revision: 0,
  status: 'idle',
  message: '尚未检查更新',
};
function ready() {
  render(
    <ConfigProvider>
      <App>
        <UpdateProvider>
          <UpdateSection />
        </UpdateProvider>
      </App>
    </ConfigProvider>,
  );
}
function event(state: UpdateState) {
  act(() => bridge.listeners.forEach((fn) => fn({ event: 'update-state', state })));
}
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.listeners.clear();
  bridge.invoke.mockResolvedValue(initial);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});
afterEach(cleanup);
describe('update interface', () => {
  it('uses event revisions to reject a stale initial response and unsubscribes on unmount', async () => {
    let resolve!: (state: UpdateState) => void;
    bridge.invoke.mockReturnValueOnce(
      new Promise<UpdateState>((done) => {
        resolve = done;
      }),
    );
    ready();
    event({
      ...initial,
      revision: 2,
      status: 'available',
      nextVersion: '0.2.0',
      message: '发现新版本',
    });
    await act(async () => resolve(initial));
    expect(screen.getByText(/新版本：0.2.0/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载更新' }).hasAttribute('disabled')).toBe(false);
    cleanup();
    expect(bridge.listeners.size).toBe(0);
  });
  it('requires download and explicit installation confirmation, cancellation performs no install', async () => {
    ready();
    await screen.findByText('尚未检查更新');
    event({
      ...initial,
      revision: 1,
      status: 'downloaded',
      nextVersion: '0.2.0',
      message: '下载完成',
    });
    fireEvent.click(screen.getByRole('button', { name: '重启安装' }));
    await screen.findByRole('dialog', { name: '重启并安装更新' });
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '重启并安装更新' })).toBeNull(),
    );
    expect(
      bridge.invoke.mock.calls.filter(([method]) => method === 'updates.install'),
    ).toHaveLength(0);
  });
  it('shows errors persistently and disables unsupported update actions', async () => {
    bridge.invoke.mockResolvedValue({
      ...initial,
      enabled: false,
      status: 'disabled',
      message: '当前运行方式不支持自动更新',
    });
    ready();
    await screen.findByText('当前运行方式不支持自动更新');
    for (const name of ['检查更新', '下载更新', '重启安装'])
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
  });
});
