import { Button, Checkbox, Empty, Form, Input, InputNumber, Radio, Select, Space, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useController } from '../controller';
import { dbOptions, type ImportRow } from '../model';
import { DataTable, Field, Footer, Panel } from '../components/shared';
import type { ConnectionInfo, TableChoice, Workspace } from '../types';

export function WorkspacesPage() {
  const c = useController();
  const { m } = c;
  const form = m.workspaceForm;
  return (
    <div className="management-layout">
      <section>
        <div className="section-heading">
          <h2>项目工作区</h2>
          <Button icon={<PlusOutlined />} onClick={() => c.editWorkspace()}>
            新建工作区
          </Button>
        </div>
        <DataTable<Workspace>
          rowKey="id"
          dataSource={m.state.workspaces}
          onRow={(row) => ({ onClick: () => c.editWorkspace(row) })}
          columns={[
            { title: '工作区', dataIndex: 'name' },
            { title: '说明', dataIndex: 'description' },
            {
              title: '连接数',
              width: 90,
              render: (_, row) =>
                m.state.connections.filter((conn) => conn.workspaceIds.includes(row.id)).length,
            },
          ]}
        />
        <Space className="top-gap">
          <Button onClick={() => void c.exportConfig()}>导出项目配置</Button>
          <Button onClick={() => void c.importConfig()}>导入项目配置</Button>
        </Space>
        <p className="hint">配置导出不包含连接密码和证书文件。</p>
      </section>
      <Panel title={form.id ? '编辑工作区' : '新建工作区'}>
        <Form layout="vertical">
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
            <Checkbox.Group
              value={form.connectionIds || []}
              options={m.state.connections.map((conn) => ({ label: conn.name, value: conn.id }))}
              onChange={(ids) => c.patch('workspaceForm', { connectionIds: ids as string[] })}
            />
          </Field>
        </Form>
        <Space wrap>
          <Button type="primary" loading={!!m.busy} onClick={() => void c.saveWorkspace()}>
            保存工作区
          </Button>
          <Button onClick={() => c.editWorkspace(m.state.workspaces.find((w) => w.id === form.id))}>
            取消修改
          </Button>
          {m.state.workspaces.some((w) => w.id === form.id) && (
            <Button danger onClick={() => void c.removeEntity('workspace', form.id)}>
              删除
            </Button>
          )}
        </Space>
      </Panel>
    </div>
  );
}
export function ConnectionsPage() {
  const c = useController();
  const { m } = c;
  const f = m.connectionForm;
  const filtered = m.state.connections.filter((conn) =>
    `${conn.name} ${conn.host} ${conn.group}`
      .toLowerCase()
      .includes(m.connectionSearch.toLowerCase()),
  );
  const workspaces = m.state.workspaces.map((w) => ({ value: w.id, label: w.name }));
  return (
    <div className="management-layout">
      <section>
        <div className="section-heading">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索连接名称、地址"
            value={m.connectionSearch}
            onChange={(e) => c.set('connectionSearch', e.target.value)}
          />
          <Space>
            <Button icon={<PlusOutlined />} onClick={() => c.editConnection()}>
              新建连接
            </Button>
            <Button onClick={() => c.navigate('import')}>导入</Button>
          </Space>
        </div>
        <DataTable<ConnectionInfo>
          rowKey="id"
          dataSource={filtered}
          locale={{ emptyText: '新建连接或导入已有会话' }}
          onRow={(row) => ({ onClick: () => c.editConnection(row) })}
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
          ]}
        />
      </section>
      <Panel title="连接配置">
        <Form layout="vertical">
          <Field label="连接名称" required>
            <Input
              value={f.name}
              onChange={(e) => c.patch('connectionForm', { name: e.target.value })}
            />
          </Field>
          <div className="form-pair">
            <Field label="服务器地址" required>
              <Input
                value={f.host}
                onChange={(e) => c.patch('connectionForm', { host: e.target.value })}
              />
            </Field>
            <Field label="端口">
              <InputNumber
                value={f.port}
                min={1}
                max={65535}
                onChange={(value) => {
                  if (value !== null) c.patch('connectionForm', { port: value });
                }}
                style={{ width: '100%' }}
              />
            </Field>
          </div>
          <div className="form-pair">
            <Field label="用户名" required>
              <Input
                value={f.user}
                onChange={(e) => c.patch('connectionForm', { user: e.target.value })}
              />
            </Field>
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
            <Input
              value={f.group}
              onChange={(e) => c.patch('connectionForm', { group: e.target.value })}
            />
          </Field>
          <Field label="关联工作区" required>
            <Select
              mode="multiple"
              value={f.workspaceIds}
              options={workspaces}
              onChange={(workspaceIds) => c.patch('connectionForm', { workspaceIds })}
            />
          </Field>
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
                  <Button onClick={() => void c.chooseCertificate('ca')}>选择</Button>
                </Space.Compact>
              </Field>
              <Field label="客户端证书（PKCS#12，可选）">
                <Space.Compact block>
                  <Input
                    value={f.clientCert}
                    onChange={(e) => c.patch('connectionForm', { clientCert: e.target.value })}
                  />
                  <Button onClick={() => void c.chooseCertificate('clientCert')}>选择</Button>
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
        <Space wrap>
          <Button loading={!!m.busy} onClick={() => void c.testConnection()}>
            测试连接
          </Button>
          <Button type="primary" loading={!!m.busy} onClick={() => void c.saveConnection()}>
            保存连接
          </Button>
          <Button
            onClick={() => c.editConnection(m.state.connections.find((conn) => conn.id === f.id))}
          >
            取消修改
          </Button>
          {m.state.connections.some((conn) => conn.id === f.id) && (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => void c.removeEntity('connection', f.id)}
              aria-label="删除连接"
            />
          )}
        </Space>
      </Panel>
    </div>
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
          <Button icon={<UploadOutlined />} onClick={() => void c.readImport()}>
            选择会话文件
          </Button>
          <span>{m.importName || '也可粘贴 XML / JSON 内容'}</span>
        </div>
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
          loading={!!m.busy}
          disabled={!m.importText && !m.importFileToken}
          onClick={() => void c.action(() => c.parseImport())}
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
                { title: '说明', render: (_, row) => row.warning || row.credentialStatus },
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
              <Input value={m.importGroup} onChange={(e) => c.set('importGroup', e.target.value)} />
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
          loading={!!m.busy}
          onClick={() => void c.submitImport()}
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
  const f = m.templateForm;
  const options = dbOptions(m);
  const templates = m.state.templates.filter((t) => t.workspaceId === m.workspaceId);
  return (
    <div className="management-layout">
      <section>
        <div className="section-heading">
          <h2>已保存模板</h2>
          <Button icon={<PlusOutlined />} onClick={() => c.editTemplate()}>
            新建模板
          </Button>
        </div>
        {templates.map((t) => (
          <button
            key={t.id}
            className={`template-card ${f.id === t.id ? 'selected' : ''}`}
            onClick={() => c.editTemplate(t)}
          >
            <strong>{t.name}</strong>
            <span>{t.description}</span>
            <span>
              {t.source.database} → {t.targets.length} 个目标库 / {t.tables.length} 张表
            </span>
          </button>
        ))}
        {!templates.length && <Empty description="尚未保存模板" />}
      </section>
      <Panel title={f.name || '新建同步模板'}>
        <Form layout="vertical">
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
                  checked={row.data}
                  onChange={(e) => c.updateTemplateTable(row.name, { data: e.target.checked })}
                />
              ),
            },
            {
              title: '匹配键',
              render: (_, row) => (
                <Input
                  value={row.keyText}
                  disabled={!row.data}
                  placeholder="默认主键"
                  onChange={(e) => c.updateTemplateTable(row.name, { keyText: e.target.value })}
                />
              ),
            },
          ]}
        />
        <Space className="top-gap" wrap>
          <Button type="primary" loading={!!m.busy} onClick={() => void c.saveTemplate()}>
            保存模板
          </Button>
          <Button
            disabled={!m.state.templates.some((t) => t.id === f.id)}
            onClick={() => c.editTemplate(m.state.templates.find((t) => t.id === f.id))}
          >
            取消修改
          </Button>
          {m.state.templates.some((t) => t.id === f.id) && (
            <>
              <Button onClick={() => void c.applyTemplate(f)}>应用模板</Button>
              <Button danger onClick={() => void c.removeEntity('template', f.id)}>
                删除
              </Button>
            </>
          )}
        </Space>
      </Panel>
    </div>
  );
}
