import { AsyncButton as Button } from './AsyncButton';
import { Form, Input, Modal, Select, type InputRef } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useController } from '../controller';

export function ConnectionOrganizationDialogs() {
  const c = useController();
  const { m } = c;
  const nameInput = useRef<InputRef>(null);
  return (
    <>
      <Modal
        title={m.groupForm ? '编辑分组' : '新增分组'}
        open={m.groupDialog}
        width={360}
        centered
        onCancel={c.closeGroup}
        onOk={() => void c.saveGroup()}
        okText="保存"
        cancelText="取消"
        confirmLoading={m.groupSubmitting}
        okButtonProps={{ disabled: !m.groupName.trim() }}
        afterOpenChange={(open) => {
          if (open) nameInput.current?.focus({ cursor: 'all' });
        }}
      >
        <Form layout="vertical" onFinish={() => void c.saveGroup()}>
          <Form.Item label="分组名称">
            <Input
              ref={nameInput}
              aria-label="分组名称"
              autoFocus
              disabled={m.groupSubmitting}
              value={m.groupName}
              onChange={(event) => c.set('groupName', event.target.value)}
              onPressEnter={() => void c.saveGroup()}
            />
          </Form.Item>
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

export function ConnectionGroupSelect() {
  const c = useController();
  const { m } = c;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const session = useRef(0);
  useEffect(() => {
    session.current += 1;
    setName('');
  }, [m.connectionForm.id, m.connectionDialog]);
  async function create() {
    if (saving || !name.trim()) return;
    setSaving(true);
    const started = session.current;
    const submitted = name;
    try {
      if ((await c.addConnectionGroup(submitted)) && started === session.current)
        setName((value) => (value === submitted ? '' : value));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Select
      aria-label="连接分组"
      placeholder="请选择连接分组"
      showSearch
      optionFilterProp="label"
      style={{ width: '100%' }}
      value={m.connectionForm.group || undefined}
      options={m.state.connectionGroups.map((group) => ({ value: group.name, label: group.name }))}
      onChange={(group) => c.patch('connectionForm', { group })}
      popupRender={(menu) => (
        <>
          {menu}
          <div className="group-select-create">
            <Input
              aria-label="新增连接分组名称"
              placeholder="新分组名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <Button
              aria-label="新增"
              icon={<PlusOutlined aria-hidden />}
              loading={saving}
              disabled={!name.trim()}
              onClick={() => create()}
            >
              新增
            </Button>
          </div>
        </>
      )}
    />
  );
}
