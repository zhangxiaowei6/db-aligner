import { Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useController } from '../controller';

export function DatabaseOptionsStatus() {
  const c = useController();
  const connections = c.m.state.connections.filter((connection) =>
    connection.workspaceIds.includes(c.m.workspaceId),
  );
  const loading = connections.some((connection) => c.m.dbLoading[connection.id]);
  const errors = connections.filter((connection) => c.m.dbErrors[connection.id]);
  return (
    <div className="bottom-gap">
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={loading}
        onClick={() => void c.loadDatabaseOptions(true)}
      >
        {loading ? '正在加载数据库' : '刷新数据库'}
      </Button>
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
