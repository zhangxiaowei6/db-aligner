import { SyncTableSelector } from '../components/SyncTableSelector';
import { DriverInstaller } from '../components/DriverInstaller';
import { DatabaseTypeIcon } from '../components/DatabaseTypeIcon';
import { AsyncButton as Button } from '../components/AsyncButton';
import { ConnectionPasswordInput } from '../components/ConnectionPasswordInput';
import {
  Alert,
  Spin,
  AutoComplete,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
} from 'antd';
import { EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { connectionTestError, importPasswordRequired } from '../connection-validation';
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
import type { ConnectionInfo, SyncTemplate, Workspace } from '../types';

export function WorkspacesPage() {
  const c = useController();
  const { m } = c;
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
      <WorkspaceEditor />
    </>
  );
}
export function WorkspaceEditor() {
  const c = useController();
  const { m } = c;
  const form = m.workspaceForm;
  return (
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
            placeholder="请输入工作区名称，例如：业务系统"
            onChange={(e) => c.patch('workspaceForm', { name: e.target.value })}
          />
        </Field>
        <Field label="说明">
          <Input.TextArea
            rows={3}
            value={form.description}
            placeholder="请输入工作区说明（选填）"
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
            {
              title: '数据库类型',
              width: 150,
              render: (_, row) => (
                <Tag icon={<DatabaseTypeIcon databaseType={row.databaseType} />}>
                  {row.databaseType === 'postgresql' ? 'PostgreSQL' : 'MySQL'}
                </Tag>
              ),
            },
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
  const hasSavedPassword = !!m.state.connections.find((connection) => connection.id === f.id)
    ?.hasPassword;
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
        <Field label="数据库类型" required>
          <Select
            placeholder="选择数据库类型"
            aria-label="数据库类型"
            value={f.databaseType || 'mysql'}
            options={[
              { value: 'mysql', label: 'MySQL' },
              { value: 'postgresql', label: 'PostgreSQL' },
            ]}
            onChange={(databaseType) => {
              const port = databaseType === 'postgresql' ? 5432 : 3306;
              c.patch('connectionForm', {
                databaseType,
                port,
                driverId: databaseType === 'postgresql' ? 'postgresql' : 'mariadb',
                driverVersion: databaseType === 'postgresql' ? '42.7.8' : '3.5.10',
                initialDatabase: databaseType === 'postgresql' ? 'postgres' : '',
              });
              connectionFields.setFieldValue('port', String(port));
            }}
          />
        </Field>
        <Field label="数据库驱动">
          <DriverInstaller
            driverId={f.driverId || (f.databaseType === 'postgresql' ? 'postgresql' : 'mariadb')}
          />
        </Field>
        {f.databaseType === 'postgresql' && (
          <Field label="初始连接数据库" required>
            <Input
              value={f.initialDatabase || ''}
              placeholder="例如：postgres"
              onChange={(e) => c.patch('connectionForm', { initialDatabase: e.target.value })}
            />
          </Field>
        )}
        <Form.Item
          label="连接名称"
          name="name"
          rules={[{ required: true, whitespace: true, message: '请输入连接名称' }]}
        >
          <Input
            value={f.name}
            placeholder="请输入连接名称，例如：开发环境"
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
              placeholder="请输入 IP 或域名，例如：127.0.0.1"
              onChange={(e) => c.patch('connectionForm', { host: e.target.value })}
            />
          </Form.Item>
          <Form.Item
            label="端口"
            name="port"
            rules={[
              { required: true, message: '请输入端口' },
              {
                validator: (_, value) =>
                  !String(value ?? '') || portFromText(String(value ?? ''))
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 1–65535 的整数端口')),
              },
            ]}
          >
            <Input
              inputMode="numeric"
              autoComplete="off"
              placeholder={
                f.databaseType === 'postgresql' ? '请输入端口，默认 5432' : '请输入端口，默认 3306'
              }
            />
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
              placeholder="请输入数据库用户名"
              onChange={(e) => c.patch('connectionForm', { user: e.target.value })}
            />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            required={!hasSavedPassword}
            extra={hasSavedPassword ? '已保存密码；留空保留，输入新密码可替换。' : undefined}
            rules={[
              {
                validator: (_, value) =>
                  hasSavedPassword || (typeof value === 'string' && value.length > 0)
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入连接密码')),
              },
            ]}
          >
            <ConnectionPasswordInput
              value={f.password}
              aria-required={!hasSavedPassword}
              hasSavedPassword={hasSavedPassword}
              onChange={(password) => c.patch('connectionForm', { password })}
            />
          </Form.Item>
        </div>
        <Field label="指定数据库（可选）">
          {m.connectionDiscovery?.status === 'success' ? (
            <Select
              mode="multiple"
              showSearch
              allowClear
              optionFilterProp="label"
              style={{ width: '100%' }}
              aria-label="指定数据库"
              placeholder="选择指定数据库，留空显示全部可访问数据库"
              value={m.databasesText
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)}
              options={[
                ...new Set([
                  ...m.connectionDiscovery.databases,
                  ...m.databasesText
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                ]),
              ].map((value) => ({
                value,
                label: m.connectionDiscovery!.databases.includes(value)
                  ? value
                  : `${value}（当前不可用）`,
              }))}
              onChange={(values) => c.set('databasesText', values.join(', '))}
            />
          ) : (
            <Input
              value={m.databasesText}
              aria-label="指定数据库"
              placeholder="留空显示可访问数据库；多个库用英文逗号分隔"
              onChange={(e) => c.set('databasesText', e.target.value)}
            />
          )}
          {m.connectionDiscovery?.status === 'loading' && (
            <p className="hint" role="status">
              正在检查连接并读取数据库列表…
            </p>
          )}
          {m.connectionDiscovery?.status === 'error' && (
            <Alert
              type="warning"
              showIcon
              title="数据库列表读取失败，可继续手动填写"
              description={m.connectionDiscovery.error}
              action={<Button onClick={() => c.discoverConnection()}>重试数据库列表</Button>}
            />
          )}
        </Field>
        <Field label="连接分组" required>
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
            placeholder="请选择至少一个工作区"
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
            <Field
              required={f.databaseType === 'postgresql'}
              label={
                f.databaseType === 'postgresql'
                  ? 'CA 证书（PEM，启用 SSL 时必填）'
                  : 'CA 证书（PEM，可留空使用系统信任）'
              }
            >
              <Space.Compact block>
                <Input
                  value={f.ca}
                  placeholder={
                    f.databaseType === 'postgresql'
                      ? '请选择 CA 的 PEM 证书文件'
                      : '请选择 PEM 证书文件，留空使用系统信任'
                  }
                  onChange={(e) => c.patch('connectionForm', { ca: e.target.value })}
                />
                <Button onClick={() => c.chooseCertificate('ca')}>选择</Button>
              </Space.Compact>
            </Field>
            <Field label="客户端证书（PKCS#12，可选）">
              <Space.Compact block>
                <Input
                  value={f.clientCert}
                  placeholder="请选择 PKCS#12 证书文件，可留空"
                  onChange={(e) => c.patch('connectionForm', { clientCert: e.target.value })}
                />
                <Button onClick={() => c.chooseCertificate('clientCert')}>选择</Button>
              </Space.Compact>
            </Field>
            {f.clientCert && (
              <Field label="证书密码">
                <Input.Password
                  value={f.certificatePassword}
                  placeholder="请输入客户端证书密码"
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
        <Form layout="vertical">
          <Field label="会话格式" required>
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
          </Field>
        </Form>
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
        <Form layout="vertical">
          <Field label="会话内容" required={!m.importFileToken}>
            <Input.TextArea
              rows={4}
              value={m.importText}
              aria-label="会话内容"
              placeholder="粘贴会话内容后解析"
              onChange={(e) =>
                c.commit((s) => ({ ...s, importText: e.target.value, importFileToken: '' }))
              }
            />
          </Field>
        </Form>
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
                    <Field
                      label="密码"
                      compact
                      required={importPasswordRequired(row, m.duplicateMode, m.state.connections)}
                    >
                      <Input.Password
                        value={row.password}
                        aria-label={`${row.name} 密码`}
                        placeholder={row.credentialStatus || '请输入连接密码'}
                        onChange={(e) => c.updateImport(row.id, { password: e.target.value })}
                      />
                    </Field>
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
                placeholder="选择要导入的工作区"
                value={m.importWorkspaceIds}
                options={m.state.workspaces.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(ids) => c.set('importWorkspaceIds', ids)}
              />
            </Field>
            <Field label="导入分组">
              <AutoComplete
                style={{ width: '100%' }}
                placeholder="选择或输入连接分组"
                value={m.importGroup}
                options={m.state.connectionGroups.map((group) => ({ value: group.name }))}
                onChange={(name) => c.set('importGroup', name)}
              />
            </Field>
            <Field label="重复连接" required>
              <Select
                placeholder="选择重复连接的处理方式"
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
            placeholder="请输入模板名称，例如：基础字典同步"
            onChange={(e) => c.patch('templateForm', { name: e.target.value })}
          />
        </Field>
        <Field label="说明">
          <Input.TextArea
            value={f.description}
            rows={3}
            placeholder="填写模板用途与适用范围（选填）"
            onChange={(e) => c.patch('templateForm', { description: e.target.value })}
          />
        </Field>
        <Field label="来源数据库" required>
          <Select
            showSearch
            placeholder="选择来源数据库或 schema"
            optionFilterProp="label"
            value={m.templateSource || undefined}
            options={options}
            onChange={(value) => void c.templateSourceChanged(value)}
          />
        </Field>
        <Field label="目标数据库" required>
          <Select
            mode="multiple"
            placeholder="选择同类型的目标数据库或 schema"
            optionFilterProp="label"
            value={m.templateTargets}
            options={options
              .filter((o) => o.value !== m.templateSource)
              .map((option) => ({
                ...option,
                disabled:
                  !!m.templateSource &&
                  option.databaseType !==
                    (m.templateSource.startsWith('pg:') ? 'postgresql' : 'mysql'),
              }))}
            onChange={(value) => c.set('templateTargets', value)}
          />
        </Field>
      </Form>
      {m.templateError && (
        <Alert
          type="error"
          showIcon
          title={m.templateError}
          action={<Button onClick={c.loadTemplateTables}>重新加载来源表</Button>}
        />
      )}
      <Spin spinning={m.templateLoading}>
        <SyncTableSelector
          id="template"
          mode={m.templateMode}
          rows={f.tables.map((table) => ({ ...table, comment: table.comment || '' }))}
          search={m.templateSearch}
          filter={m.templateFilter}
          defaults={m.templateStructureDefaults}
          databaseType={m.templateSource.startsWith('pg:') ? 'postgresql' : 'mysql'}
          disabled={m.templateSubmitting || m.templateLoading}
          onMode={c.setTemplateMode}
          onSearch={(value) => c.set('templateSearch', value)}
          onFilter={(value) => c.set('templateFilter', value)}
          onDefaults={(value) => c.set('templateStructureDefaults', value)}
          onApplyDefaults={() => c.applyStructureDefaults(true)}
          onUpdate={c.updateTemplateTable}
          onToggle={c.toggleTemplateTables}
        />
      </Spin>
    </Modal>
  );
}
