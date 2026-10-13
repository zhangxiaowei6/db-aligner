import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Progress, Space } from 'antd';
import { api, onEvent } from './api';
import { AsyncButton } from './components/AsyncButton';
import type { UpdateState } from './types';
import { version } from '../package.json';

const UpdateContext = createContext<{
  state: UpdateState;
  action: (method: 'updates.check' | 'updates.download' | 'updates.install') => Promise<void>;
} | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({
    version,
    enabled: false,
    revision: -1,
    status: 'idle',
    message: '正在读取更新状态',
  });
  const latest = useRef(state);
  const mounted = useRef(false);
  const notified = useRef('');
  const { message } = App.useApp();
  function receive(next: UpdateState) {
    if (!mounted.current || next.revision < latest.current.revision) return;
    latest.current = next;
    setState(next);
    if (next.status === 'available' && next.nextVersion !== notified.current) {
      notified.current = next.nextVersion || '';
      void message.info(`发现 DBAligner ${next.nextVersion}，可在设置中下载更新`, 6);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onEvent((event) => {
      if (event.event === 'update-state') receive(event.state as UpdateState);
    });
    void api<UpdateState>('updates.get')
      .then(receive)
      .catch(() => {
        receive({
          ...latest.current,
          status: 'error',
          message: '无法读取更新状态，请重新启动客户端',
        });
      });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);
  async function action(method: 'updates.check' | 'updates.download' | 'updates.install') {
    receive(await api<UpdateState>(method));
  }
  return <UpdateContext.Provider value={{ state, action }}>{children}</UpdateContext.Provider>;
}

export function UpdateSection() {
  const value = useContext(UpdateContext);
  const { modal } = App.useApp();
  if (!value) return null;
  const { state, action } = value;
  const busy = ['checking', 'downloading', 'installing'].includes(state.status);
  async function install() {
    const accepted = await new Promise<boolean>((resolve) => {
      modal.confirm({
        title: '重启并安装更新',
        content: `将安装 DBAligner ${state.nextVersion} 并重启客户端。请先保存页面草稿；有运行或排队任务时不会安装。连接、记录和恢复资料会保留。`,
        okText: '重启安装',
        cancelText: '取消',
        onOk: () => {
          resolve(true);
        },
        onCancel: () => {
          resolve(false);
        },
      });
    });
    if (accepted) await action('updates.install');
  }
  return (
    <section aria-label="客户端更新">
      <p>
        当前版本：{state.version}
        {state.nextVersion ? ` · 新版本：${state.nextVersion}` : ''}
      </p>
      <Alert
        showIcon
        type={state.status === 'error' ? 'warning' : 'info'}
        title={
          <span role="status" aria-live="polite">
            {state.message}
          </span>
        }
      />
      {state.status === 'downloading' && <Progress percent={Math.round(state.percent || 0)} />}
      <Space wrap className="top-gap">
        <AsyncButton
          disabled={!state.enabled || busy || state.status === 'downloaded'}
          onClick={() => action('updates.check')}
        >
          检查更新
        </AsyncButton>
        <AsyncButton
          disabled={state.status !== 'available'}
          onClick={() => action('updates.download')}
        >
          下载更新
        </AsyncButton>
        <AsyncButton type="primary" disabled={state.status !== 'downloaded'} onClick={install}>
          重启安装
        </AsyncButton>
      </Space>
      <p className="hint">
        仅检查正式版本，确认后下载并安装。检查与下载会访问 GitHub，不上传连接、密码、SQL
        或本地记录。安装包暂未签名。
      </p>
    </section>
  );
}
