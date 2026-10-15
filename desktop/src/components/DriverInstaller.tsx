import { useEffect, useRef, useState } from 'react';
import { Alert, Space, Tag, Select } from 'antd';
import { AsyncButton } from './AsyncButton';
import { api, onEvent, preview } from '../api';
import type { DriverState } from '../types';

export function DriverInstaller({ driverId }: { driverId: string }) {
  const [state, setState] = useState<DriverState>();
  const [error, setError] = useState('');
  const [simulateFailure, setSimulateFailure] = useState(false);
  const revision = useRef(-1);
  useEffect(() => {
    let active = true;
    revision.current = -1;
    setState(undefined);
    setError('');
    const accept = (value: DriverState) => {
      if (!active || value.id !== driverId || value.revision < revision.current) return;
      revision.current = value.revision;
      setState(value);
    };
    const stop = onEvent((event) => {
      if (event.event === 'driver-state') accept(event.state as DriverState);
    });
    void api<DriverState>('drivers.get', { driverId })
      .then(accept)
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
      stop();
    };
  }, [driverId]);
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Space wrap>
        <Tag color={state?.status === 'installed' ? 'success' : 'default'}>
          {state?.status === 'installed' ? '驱动已安装' : '驱动未就绪'}
        </Tag>
        <span>{state ? `${state.name} ${state.version}` : '正在读取驱动状态'}</span>
        {state && state.status !== 'installed' && state.status !== 'downloading' && (
          <AsyncButton
            onClick={() =>
              api('drivers.install', { driverId, ...(preview ? { simulateFailure } : {}) })
            }
          >
            安装驱动
          </AsyncButton>
        )}
        {state?.status === 'downloading' && (
          <AsyncButton onClick={() => api('drivers.cancel', { driverId })}>取消安装</AsyncButton>
        )}
      </Space>
      {(error || state?.message) && (
        <span role="status" aria-label="驱动安装状态">
          {error || state?.message}
        </span>
      )}
      {preview && state?.status !== 'installed' && (
        <Select
          aria-label="预览下载场景"
          placeholder="选择驱动下载演示场景"
          size="small"
          value={simulateFailure ? 'error' : 'normal'}
          options={[
            { value: 'normal', label: '模拟正常下载' },
            { value: 'error', label: '模拟网络失败' },
          ]}
          onChange={(value) => setSimulateFailure(value === 'error')}
        />
      )}
      {preview && <Alert type="info" title="浏览器预览只模拟驱动状态，不下载或加载 JDBC 文件。" />}
      {state && <span>{state.license} · 同步能力由数据库版本和表定义决定</span>}
    </Space>
  );
}
