import { Button, Form, Input, Modal, Select, Space } from 'antd';
import { useController } from '../controller';

export function ConnectionOrganizationDialogs() {
  const c = useController();
  const { m } = c;
  return (
    <>
      <Modal
        title="管理连接分组"
        open={m.groupDialog}
        onCancel={() => c.set('groupDialog', false)}
        footer={<Button onClick={() => c.set('groupDialog', false)}>关闭</Button>}
      >
        <div className="group-list">
          {m.state.connectionGroups.map((group) => (
            <div className="group-list-row" key={group.id}>
              <span>{group.name}</span>
              <Button size="small" onClick={() => c.editGroup(group)}>
                编辑名称
              </Button>
            </div>
          ))}
        </div>
        <Form layout="vertical" onFinish={() => void c.saveGroup()}>
          <Form.Item label={m.groupForm ? `编辑分组：${m.groupForm.name}` : '新增分组'}>
            <Input
              aria-label="分组名称"
              autoFocus
              value={m.groupName}
              onChange={(event) => c.set('groupName', event.target.value)}
            />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={!!m.busy}
              disabled={!m.groupName.trim()}
            >
              保存分组
            </Button>
            {m.groupForm && <Button onClick={() => c.editGroup()}>新增分组</Button>}
          </Space>
        </Form>
      </Modal>
      <Modal
        title="更换连接分组"
        open={!!m.moveConnectionId}
        onCancel={() => c.set('moveConnectionId', '')}
        onOk={() => void c.moveConnection(m.moveConnectionId, m.moveGroupId, 'last')}
        okText="更换分组"
        cancelText="取消"
        confirmLoading={m.organizationSaving}
        okButtonProps={{ disabled: !m.moveGroupId }}
      >
        <p>
          {m.state.connections.find((connection) => connection.id === m.moveConnectionId)?.name}
        </p>
        <Select
          aria-label="目标分组"
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          value={m.moveGroupId || undefined}
          options={m.state.connectionGroups.map((group) => ({
            value: group.id,
            label: group.name,
          }))}
          onChange={(id) => c.set('moveGroupId', id)}
        />
      </Modal>
    </>
  );
}
