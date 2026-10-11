import { AsyncButton as Button } from '../components/AsyncButton';
import {
  StructureOptionsEditor,
  TableStructureOptions,
} from '../components/StructureOptionsEditor';
import { AutoComplete, Checkbox, Form, Input, Modal, Radio, Select, Space, Tag } from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { connectionTestError } from '../connection-validation';
import { orderedConnections, portFromText } from '../connection-organization';
import { useController } from '../controller';
import { preview } from '../api';
import { dbOptions, type ImportRow } from '../model';
import {
  ConnectionTestButton,
  ConnectionTestFeedback,
  DataTable,
  Field,
  Footer,
  Panel,
} from '../components/shared';
import { DatabaseOptionsStatus } from '../components/DatabaseOptionsStatus';
import { ConnectionGroupSelect } from '../components/ConnectionOrganization';
import type { ConnectionInfo, SyncTemplate, TableChoice, Workspace } from '../types';

export function WorkspacesPage() {
  const c = useController();
  const { m } = c;
  const form = m.workspaceForm;
  return (
    <>
      <section>
        <div className="section-heading">
          <h2>项目工作区</h2>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => c.editWorkspace()}>
            新建工作区
          </Button>
        </div>
        <DataTable<Workspace>
          rowKey="id"
          dataSource={m.state.workspaces}
          columns={[
            { title: '工作区', dataIndex: 'name' },
            { title: '说明', dataIndex: 'description' },
            {
              title: '连接数',
              width: 90,
              render: (_, row) =>
                m.state.connections.filter((conn) => conn.workspaceIds.includes(row.id)).length,
            },
            {
              title: '操作',
              key: 'actions',
              width: 160,
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined aria-hidden />}
                    aria-label={`编辑工作区 ${row.name}`}
                    onClick={() => c.editWorkspace(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    danger
                    size="small"
                    aria-label={`删除工作区 ${row.name}`}
                    disabled={m.workspaceSubmitting}
                    onClick={() => c.removeEntity('workspace', row.id)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        <Space className="top-gap">
          <Button onClick={() => c.exportConfig()}>导出项目配置</Button>
          <Button onClick={() => c.importConfig()}>导入项目配置</Button>
        </Space>
        <p className="hint">配置导出不包含连接密码和证书文件。</p>
      </section>
      <Modal
        title={m.state.workspaces.some((w) => w.id === form.id) ? '编辑工作区' : '新建工作区'}
        open={m.workspaceDialog}
        centered
        width={560}
        onCancel={c.closeWorkspace}
        onOk={() => void c.saveWorkspace()}
        okText="保存工作区"
        cancelText="取消"
        confirmLoading={m.workspaceSubmitting}
        okButtonProps={{ disabled: !form.name.trim() }}
        destroyOnHidden
        styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      >
        <Form layout="vertical" disabled={m.workspaceSubmitting}>
          <Field label="工作区名称" required>
            <Input
              value={form.name}
              onChange={(e) => c.patch('workspaceForm', { name: e.target.value })}
            />
          </Field>
          <Field label="说明">
            <Input.TextArea
              rows={3}
              value={form.description}
              onChange={(e) => c.patch('workspaceForm', { description: e.target.value })}
            />
          </Field>
          <Field label="关联连接">
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="选择关联连接"
              value={form.connectionIds || []}
              options={m.state.connections.map((conn) => ({ label: conn.name, value: conn.id }))}
              onChange={(ids) => c.patch('workspaceForm', { connectionIds: ids })}
            />
          </Field>
        </Form>
      </Modal>
    </>
  );
}
export function ConnectionsPage() {
  const c = useController();
  const { m } = c;
  const filtered = orderedConnections(m.state.connections).filter((conn) =>
    `${conn.name} ${conn.host} ${conn.group}`
      .toLowerCase()
      .includes(m.connectionSearch.toLowerCase()),
  );
  return (
    <>
      <section>
        <div className="section-heading connection-toolbar">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索连接名称、地址"
            value={m.connectionSearch}
            onChange={(e) => c.set('connectionSearch', e.target.value)}
          />
          <Space>
            <Button
              danger
              disabled={!m.connectionSelection.length}
              onClick={() => c.removeConnections()}
            >
              批量删除{m.connectionSelection.length ? `（${m.connectionSelection.length}）` : ''}
            </Button>
            <Button type="primary" onClick={() => c.editConnection()}>
              新建连接
            </Button>
            <Button onClick={() => c.navigate('import')}>导入</Button>
          </Space>
        </div>
        <DataTable<ConnectionInfo>
          rowKey="id"
          dataSource={filtered}
          rowSelection={{
            selectedRowKeys: m.connectionSelection,
            preserveSelectedRowKeys: true,
            onChange: (keys) => c.set('connectionSelection', keys as string[]),
            getCheckboxProps: (row) => ({ 'aria-label': `选择连接 ${row.name}` }),
          }}
          locale={{ emptyText: '新建连接或导入已有会话' }}
          columns={[
            { title: '连接名称', dataIndex: 'name' },
            { title: '地址', render: (_, row) => `${row.host}:${row.port}` },
            { title: '分组', dataIndex: 'group' },
            {
              title: '凭据',
              width: 90,
              render: (_, row) => (
                <Tag color={row.hasPassword ? 'default' : 'warning'}>
                  {row.hasPassword ? '已保存' : '待填写'}
                </Tag>
              ),
            },
            {
              title: '操作',
              key: 'actions',
              width: 280,
              render: (_, row) => (
                <div
                  className="connection-row-actions"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="connection-actions-scroll">
                    <Space size={8}>
                      <ConnectionTestButton
                        size="small"
                        result={m.connectionTests[row.id]}
                        successDetails
                        disabled={!!connectionTestError(row)}
                        aria-label={`测试连接 ${row.name}`}
                        onClick={() => c.testConnection(row)}
                      />
                      <Button
                        size="small"
                        icon={<EditOutlined aria-hidden />}
                        aria-label={`编辑连接 ${row.name}`}
                        onClick={() => c.editConnection(row)}
                      >
                        编辑
                      </Button>
                      <Button
                        danger
                        size="small"
                        aria-label={`删除连接 ${row.name}`}
                        onClick={() => c.removeConnections([row.id])}
                      >
                        删除
                      </Button>
                    </Space>
                  </div>
                  <ConnectionTestFeedback result={m.connectionTests[row.id]} hideSuccess />
                </div>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
export function ConnectionEditor() {
  const c = useController();
  const { m } = c;
  const f = m.connectionForm;
  const [connectionFields] = Form.useForm();
  useEffect(() => {
    if (!m.connectionDialog) return;
    connectionFields.resetFields();
    connectionFields.setFieldsValue({ ...f, port: String(f.port) });
  }, [m.connectionDialog, f.id, connectionFields]);
  const workspaces = m.state.workspaces.map((w) => ({ value: w.id, label: w.name }));
  return (
    <Modal
      title={
        m.state.connections.some((connection) => connection.id === f.id) ? '编辑连接' : '新建连接'
      }
      open={m.connectionDialog}
      onCancel={c.closeConnection}
      centered
      width={720}
      footer={
        <div className="connection-dialog-footer">
          <div className="connection-dialog-test">
            <ConnectionTestButton
              aria-label="测试连接"
              result={m.connectionTest}
              disabled={!!connectionTestError(f) || !f.workspaceIds.length}
              onClick={() => c.testConnection()}
            />
            <ConnectionTestFeedback result={m.connectionTest} />
          </div>
          <Space>
            <Button
              type="primary"
              onClick={() =>
                connectionFields
                  .validateFields()
                  .then(() => c.saveConnection())
                  .catch(() => {})
              }
            >
              保存连接
            </Button>
            <Button onClick={c.closeConnection}>取消</Button>
          </Space>
        </div>
      }
      destroyOnHidden
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      <Form
        form={connectionFields}
        layout="vertical"
        validateTrigger="onBlur"
        onValuesChange={(values) => {
          if (Object.hasOwn(values, 'port'))
            c.patch('connectionForm', { port: portFromText(String(values.port)) });
        }}
      >
        <Form.Item
          label="连接名称"
          name="name"
          rules={[{ required: true, whitespace: true, message: '请输入连接名称' }]}
        >
          <Input
            value={f.name}
            onChange={(e) => c.patch('connectionForm', { name: e.target.value })}
          />
        </Form.Item>
        <div className="form-pair">
          <Form.Item
            label="服务器地址"
            name="host"
            rules={[
              { required: true, whitespace: true, message: '请输入服务器地址' },
              { pattern: /^[a-zA-Z0-9.\-:\[\]]+$/, message: '请输入有效的服务器地址' },
            ]}
          >
            <Input
              value={f.host}
              onChange={(e) => c.patch('connectionForm', { host: e.target.value })}
            />
          </Form.Item>
          <Form.Item
            label="端口"
            name="port"
            rules={[
              {
                validator: (_, value) =>
                  portFromText(String(value ?? ''))
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 1–65535 的整数端口')),
              },
            ]}
          >
            <Input inputMode="numeric" autoComplete="off" />
          </Form.Item>
        </div>
        <div className="form-pair">
          <Form.Item
            label="用户名"
            name="user"
            rules={[{ required: true, whitespace: true, message: '请输入用户名' }]}
          >
            <Input
              value={f.user}
              onChange={(e) => c.patch('connectionForm', { user: e.target.value })}
            />
          </Form.Item>
          <Field label="密码">
            <Input.Password
              value={f.password}
              placeholder={f.hasPassword ? '已保存；留空保留原密码' : '填写连接密码'}
              onChange={(e) => c.patch('connectionForm', { password: e.target.value })}
            />
          </Field>
        </div>
        <Field label="指定数据库（可选）">
          <Input
            value={m.databasesText}
            placeholder="shop_test, shop_a"
            onChange={(e) => c.set('databasesText', e.target.value)}
          />
        </Field>
        <Field label="连接分组">
          <ConnectionGroupSelect />
        </Field>
        <Form.Item
          label="关联工作区"
          name="workspaceIds"
          rules={[{ required: true, type: 'array', min: 1, message: '请选择至少一个工作区' }]}
        >
          <Select
            mode="multiple"
            value={f.workspaceIds}
            options={workspaces}
            onChange={(workspaceIds) => c.patch('connectionForm', { workspaceIds })}
          />
        </Form.Item>
        <Form.Item>
          <Checkbox
            checked={f.ssl}
            onChange={(e) => c.patch('connectionForm', { ssl: e.target.checked })}
          >
            启用 SSL，验证证书与服务器名称
          </Checkbox>
        </Form.Item>
        {f.ssl && (
          <>
            <Field label="CA 证书（PEM，可留空使用系统信任）">
              <Space.Compact block>
                <Input
                  value={f.ca}
                  onChange={(e) => c.patch('connectionForm', { ca: e.target.value })}
                />
                <Button onClick={() => c.chooseCertificate('ca')}>选择</Button>
              </Space.Compact>
            </Field>
            <Field label="客户端证书（PKCS#12，可选）">
              <Space.Compact block>
                <Input
                  value={f.clientCert}
                  onChange={(e) => c.patch('connectionForm', { clientCert: e.target.value })}
                />
                <Button onClick={() => c.chooseCertificate('clientCert')}>选择</Button>
              </Space.Compact>
            </Field>
            {f.clientCert && (
              <Field label="证书密码">
                <Input.Password
                  value={f.certificatePassword}
                  onChange={(e) =>
                    c.patch('connectionForm', { certificatePassword: e.target.value })
                  }
                />
              </Field>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
}

export function ImportPage() {
  const c = useController();
  const { m } = c;
  return (
    <>
      <Panel>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={m.importFormat}
          options={[
            { label: 'Navicat .ncx', value: 'navicat' },
            { label: 'DBeaver JSON', value: 'dbeaver' },
            { label: 'DataGrip XML', value: 'datagrip' },
          ]}
          onChange={(e) =>
            c.commit((s) => ({ ...s, importFormat: e.target.value as string, importRows: [] }))
          }
        />
        <div className="button-row">
          <Button icon={<UploadOutlined />} onClick={() => c.readImport()}>
            选择会话文件
          </Button>
          <span>{m.importName || '也可粘贴 XML / JSON 内容'}</span>
          {preview && <Button onClick={() => c.loadImportExample()}>重新加载示例</Button>}
        </div>
        {preview && (
          <p className="hint">
            示例仅模拟连接测试；先填写有效的必填参数，密码填写 preview-fail 可查看失败状态。
          </p>
        )}
        <Input.TextArea
          rows={4}
          value={m.importText}
          aria-label="会话内容"
          placeholder="粘贴会话内容后解析"
          onChange={(e) =>
            c.commit((s) => ({ ...s, importText: e.target.value, importFileToken: '' }))
          }
        />
        <Button
          className="top-gap"
          disabled={!m.importText && !m.importFileToken}
          onClick={() => c.action(() => c.parseImport())}
        >
          解析会话
        </Button>
        {!!m.importRows.length && (
          <div className="top-gap">
            <DataTable<ImportRow>
              rowKey="id"
              dataSource={m.importRows}
              scroll={{ x: 1000 }}
              rowSelection={{
                selectedRowKeys: m.importRows.filter((r) => r.selected).map((r) => r.id),
                preserveSelectedRowKeys: true,
                getCheckboxProps: (r) => ({
                  disabled: !!r.warning,
                  'aria-label': `选择 ${r.name}`,
                }),
                onChange: (keys) =>
                  c.commit((s) => ({
                    ...s,
                    importRows: s.importRows.map((r) => ({
                      ...r,
                      selected: !r.warning && keys.includes(r.id),
                    })),
                  })),
              }}
              columns={[
                { title: '连接名称', dataIndex: 'name', width: 180 },
                { title: '服务器', width: 250, render: (_, row) => `${row.host}:${row.port}` },
                { title: '用户', dataIndex: 'user', width: 130 },
                {
                  title: '凭据',
                  width: 220,
                  render: (_, row) => (
                    <Input.Password
                      value={row.password}
                      aria-label={`${row.name} 密码`}
                      placeholder={row.credentialStatus}
                      onChange={(e) => c.updateImport(row.id, { password: e.target.value })}
                    />
                  ),
                },
                {
                  title: '说明',
                  key: 'description',
                  width: 240,
                  render: (_, row) => row.warning || row.credentialStatus,
                },
                {
                  title: '测试连接',
                  key: 'connectionTest',
                  width: 300,
                  render: (_, row) => (
                    <div className="import-connection-test">
                      <ConnectionTestButton
                        size="small"
                        disabled={!!row.warning || !!connectionTestError(row)}
                        result={row.connectionTest}
                        aria-label={`测试 ${row.name} 连接`}
                        onClick={() => c.testImportConnection(row.id)}
                      />
                      <ConnectionTestFeedback result={row.connectionTest} />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
        <Form layout="vertical" className="top-gap">
          <div className="form-pair">
            <Field label="导入工作区" required>
              <Select
                mode="multiple"
                value={m.importWorkspaceIds}
                options={m.state.workspaces.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(ids) => c.set('importWorkspaceIds', ids)}
              />
            </Field>
            <Field label="导入分组">
              <AutoComplete
                style={{ width: '100%' }}
                value={m.importGroup}
                options={m.state.connectionGroups.map((group) => ({ value: group.name }))}
                onChange={(name) => c.set('importGroup', name)}
              />
            </Field>
            <Field label="重复连接">
              <Select
                value={m.duplicateMode}
                options={[
                  { label: '跳过', value: 'skip' },
                  { label: '更新已有连接', value: 'update' },
                  { label: '另存新连接', value: 'copy' },
                ]}
                onChange={(value) => c.set('duplicateMode', value)}
              />
            </Field>
          </div>
        </Form>
        <p className="hint">不能解密的密码需要补充；SSH 隧道连接暂不导入。</p>
      </Panel>
      <Footer>
        <span className="footer-summary">
          已选 {m.importRows.filter((r) => r.selected).length} 个连接 · 工作区{' '}
          {m.state.workspaces.find((w) => w.id === m.workspaceId)?.name}
        </span>
        <Button
          type="primary"
          disabled={!m.importRows.some((r) => r.selected) || !m.importWorkspaceIds.length}
          onClick={() => c.submitImport()}
        >
          确认导入
        </Button>
      </Footer>
    </>
  );
}
export function TemplatesPage() {
  const c = useController();
  const { m } = c;
  const templates = m.state.templates.filter((t) => t.workspaceId === m.workspaceId);
  return (
    <>
      <section>
        <div className="section-heading">
          <h2>已保存模板</h2>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => c.editTemplate()}>
            新建模板
          </Button>
        </div>
        <DataTable<SyncTemplate>
          rowKey="id"
          dataSource={templates}
          locale={{ emptyText: '尚未保存模板' }}
          columns={[
            { title: '模板名称', dataIndex: 'name' },
            { title: '说明', dataIndex: 'description' },
            { title: '来源数据库', render: (_, row) => row.source.database },
            { title: '目标库数', width: 90, render: (_, row) => row.targets.length },
            { title: '表数', width: 65, render: (_, row) => row.tables.length },
            {
              title: '操作',
              key: 'actions',
              width: 280,
              render: (_, row) => (
                <Space>
                  <Button
                    size="small"
                    icon={<EditOutlined aria-hidden />}
                    aria-label={`编辑模板 ${row.name}`}
                    onClick={() => c.editTemplate(row)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    disabled={
                      !!m.applyingTemplateId ||
                      (!!m.compareTask && ['RUNNING', 'CANCELLING'].includes(m.compareTask.status))
                    }
                    aria-label={`应用模板 ${row.name}`}
                    onClick={() => c.applyTemplate(row)}
                  >
                    应用模板
                  </Button>
                  <Button
                    danger
                    size="small"
                    aria-label={`删除模板 ${row.name}`}
                    disabled={m.templateSubmitting}
                    onClick={() => c.removeEntity('template', row.id)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </section>
      <TemplateEditor />
    </>
  );
}
export function TemplateEditor() {
  const c = useController();
  const { m } = c;
  const f = m.templateForm;
  const options = dbOptions(m);
  return (
    <Modal
      title={m.state.templates.some((t) => t.id === f.id) ? '编辑同步模板' : '新建同步模板'}
      open={m.templateDialog}
      centered
      width={960}
      onCancel={c.closeTemplate}
      destroyOnHidden
      styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}
      footer={
        <Space>
          <Button onClick={c.closeTemplate}>取消</Button>
          <Button
            type="primary"
            loading={m.templateSubmitting}
            disabled={!f.name.trim() || !m.templateSource || !m.templateTargets.length}
            onClick={() => c.saveTemplate()}
          >
            保存模板
          </Button>
        </Space>
      }
    >
      <DatabaseOptionsStatus scope="template" />
      <Form layout="vertical" disabled={m.templateSubmitting}>
        <Field label="模板名称" required>
          <Input
            value={f.name}
            onChange={(e) => c.patch('templateForm', { name: e.target.value })}
          />
        </Field>
        <Field label="说明">
          <Input.TextArea
            value={f.description}
            rows={3}
            onChange={(e) => c.patch('templateForm', { description: e.target.value })}
          />
        </Field>
        <Field label="来源数据库" required>
          <Select
            showSearch
            optionFilterProp="label"
            value={m.templateSource || undefined}
            options={options}
            onChange={(value) => void c.templateSourceChanged(value)}
          />
        </Field>
        <Field label="目标数据库" required>
          <Select
            mode="multiple"
            optionFilterProp="label"
            value={m.templateTargets}
            options={options.filter((o) => o.value !== m.templateSource)}
            onChange={(value) => c.set('templateTargets', value)}
          />
        </Field>
      </Form>
      <Field label="同步类型">
        <Radio.Group
          value={m.templateMode}
          disabled={m.templateSubmitting}
          onChange={(event) => c.setTemplateMode(event.target.value)}
          options={[
            { label: '同步结构', value: 'structure' },
            { label: '同步数据', value: 'data' },
          ]}
        />
      </Field>
      {m.templateMode === 'structure' && (
        <div className="structure-defaults">
          <strong>统一结构默认</strong>
          <StructureOptionsEditor
            value={m.templateStructureDefaults}
            disabled={m.templateSubmitting}
            onChange={(options) => c.set('templateStructureDefaults', options)}
          />
          <Button
            size="small"
            disabled={m.templateSubmitting}
            onClick={() => c.applyStructureDefaults(true)}
          >
            应用到当前已选结构表
          </Button>
        </div>
      )}
      <DataTable<TableChoice>
        rowKey="name"
        dataSource={f.tables}
        columns={[
          { title: '表名', dataIndex: 'name' },
          {
            title: '结构',
            width: 65,
            align: 'center',
            render: (_, row) => (
              <Checkbox
                aria-label={`${row.name} 模板结构`}
                disabled={m.templateSubmitting || m.templateMode !== 'structure'}
                checked={row.structure}
                onChange={(e) => c.updateTemplateTable(row.name, { structure: e.target.checked })}
              />
            ),
          },
          {
            title: '数据',
            width: 65,
            align: 'center',
            render: (_, row) => (
              <Checkbox
                aria-label={`${row.name} 模板数据`}
                disabled={m.templateSubmitting || m.templateMode !== 'data'}
                checked={row.data}
                onChange={(e) => c.updateTemplateTable(row.name, { data: e.target.checked })}
              />
            ),
          },
          {
            title: '结构细项',
            width: 130,
            render: (_, row) => (
              <TableStructureOptions
                label={`${row.name} 模板结构细项`}
                value={row.structureOptions}
                disabled={m.templateSubmitting || !row.structure}
                onChange={(options) =>
                  c.updateTemplateTable(row.name, { structureOptions: options })
                }
              />
            ),
          },
          {
            title: '匹配键',
            render: (_, row) => (
              <Input
                value={row.keyText}
                disabled={m.templateSubmitting || !row.data}
                placeholder="默认主键"
                onChange={(e) => c.updateTemplateTable(row.name, { keyText: e.target.value })}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
