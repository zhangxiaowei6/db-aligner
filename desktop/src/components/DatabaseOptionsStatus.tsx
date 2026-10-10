import { Alert } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useController } from '../controller';
import { RefreshButton } from './AsyncButton';

export function DatabaseOptionsStatus() {
  const c = useController();
  const connections = c.m.state.connections.filter((connection) =>
    connection.workspaceIds.includes(c.m.workspaceId),
  );
  const loading =
    !!c.m.refreshing.databases || connections.some((connection) => c.m.dbLoading[connection.id]);
  const errors = connections.filter((connection) => c.m.dbErrors[connection.id]);
  return (
    <div className="bottom-gap">
      <RefreshButton
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        result={c.m.refreshResults.databases}
        disabled={!connections.length}
        onClick={() => c.refreshDatabaseOptions()}
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
