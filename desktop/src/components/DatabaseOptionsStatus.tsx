import { Alert } from 'antd';
import { useEffect, useId } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { useController } from '../controller';
import { RefreshButton } from './AsyncButton';

export function DatabaseOptionsStatus({
  scope,
}: {
  scope: 'sync' | 'template' | 'export' | 'test';
}) {
  const c = useController();
  const id = useId();
  const key = `${scope}:databases:${id}:${c.m.workspaceId}`;
  const clearRefresh = c.clearRefresh;
  useEffect(() => () => clearRefresh(key), [key, clearRefresh]);
  const connections = c.m.state.connections.filter((connection) =>
    connection.workspaceIds.includes(c.m.workspaceId),
  );
  const loading = !!c.m.refreshing[key];
  const errors = connections.filter((connection) => c.m.dbErrors[connection.id]);
  return (
    <div className="bottom-gap" data-feedback-key={key}>
      <RefreshButton
        key={key}
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        result={c.m.refreshResults[key]}
        disabled={!connections.length}
        onClick={() => c.refreshDatabaseOptions(key)}
      >
        刷新数据库
      </RefreshButton>
      {!!errors.length && (
        <Alert
          className="top-gap"
          type="warning"
          showIcon
          title="部分连接的数据库加载失败"
          description={errors
            .map((connection) => `${connection.name}：${c.m.dbErrors[connection.id]}`)
            .join('；')}
        />
      )}
    </div>
  );
}
