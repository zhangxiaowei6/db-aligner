import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowRightOutlined,
  DatabaseOutlined,
  EditOutlined,
  FileOutlined,
  PlusOutlined,
  SearchOutlined,
  TableOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useController } from '../controller';
import {
  changesOf,
  dbOptions,
  displayValue,
  kindLabels,
  leaves,
  recoveryNodes,
  reviewNodes,
  rollbackLeaves,
  selection,
  type ReviewNode,
  type ScopeTable,
} from '../model';
import { DataTable, Field, Footer, Panel } from '../components/shared';
import SqlView from '../components/SqlView';

export function ScopePage() {
  const c = useController();
  const { m } = c;
  if (!m.state.connections.length)
    return (
      <div className="onboarding">
        <DatabaseOutlined />
        <h2>添加你的第一个数据库连接</h2>
        <p>导入已有会话，或新建连接，再选择源库、目标库和同步表。</p>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => c.editConnection()}>
            新建连接
          </Button>
          <Button icon={<UploadOutlined />} onClick={() => c.navigate('import')}>
            导入会话
          </Button>
        </Space>
      </div>
    );
  const options = dbOptions(m);
  const filtered = m.scopeTables.filter((t) =>
    t.name.toLowerCase().includes(m.tableSearch.toLowerCase()),
  );
  const templates = m.state.templates.filter((t) => t.workspaceId === m.workspaceId);
  return (
    <>
      <div className="scope-layout">
        <Panel title="来源与目标">
          <Form layout="vertical">
            <div className="source-target-form">
              <Field label="来源数据库">
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="展开左侧连接加载数据库"
                  value={m.sourceKey || undefined}
                  options={options}
                  onChange={(value) => void c.loadScope(value)}
                />
              </Field>
              <ArrowRightOutlined className="flow-arrow" />
              <Field label="目标数据库（可多选）">
                <Select
                  mode="multiple"
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  value={m.targetKeys}
                  placeholder="选择目标库"
                  options={options.filter((o) => o.value !== m.sourceKey)}
                  onChange={(keys) => c.set('targetKeys', keys)}
                />
              </Field>
            </div>
          </Form>
          <div className="section-heading">
            <h2>选择需要比较的表</h2>
            <Input
              className="short-input"
              prefix={<SearchOutlined />}
              placeholder="搜索表名"
              value={m.tableSearch}
              onChange={(e) => c.set('tableSearch', e.target.value)}
            />
          </div>
          <div className="scope-toolbar">
            <Space wrap>
              <Button type="text" onClick={() => c.setScopeAll(true, 'structure')}>
                全选结构
              </Button>
              <Button type="text" onClick={() => c.setScopeAll(false, 'structure')}>
                取消结构
              </Button>
              <Button type="text" onClick={() => c.setScopeAll(true, 'data')}>
                全选数据
              </Button>
              <Button type="text" onClick={() => c.setScopeAll(false, 'data')}>
                取消数据
              </Button>
            </Space>
            <span className="hint">只读取已选表的结构与数据</span>
          </div>
          <DataTable<ScopeTable>
            rowKey="name"
            dataSource={filtered}
            locale={{ emptyText: '选择源库后加载表名' }}
            columns={[
              {
                title: '表名',
                render: (_, row) => (
                  <>
                    <TableOutlined /> {row.name}
                    <div className="secondary">{row.comment}</div>
                  </>
                ),
              },
              {
                title: '表结构',
                width: 85,
                align: 'center',
                render: (_, row) => (
                  <Checkbox
                    checked={row.structure}
                    aria-label={`${row.name} 表结构`}
                    onChange={(e) => c.updateScope(row.name, { structure: e.target.checked })}
                  />
                ),
              },
              {
                title: '基础数据',
                width: 90,
                align: 'center',
                render: (_, row) => (
                  <Checkbox
                    checked={row.data}
                    aria-label={`${row.name} 基础数据`}
                    onChange={(e) => c.updateScope(row.name, { data: e.target.checked })}
                  />
                ),
              },
              {
                title: '匹配键',
                width: 240,
                render: (_, row) => (
                  <Input
                    value={row.keyText}
                    disabled={!row.data}
                    placeholder="默认主键；复合键用逗号分隔"
                    aria-label={`${row.name} 匹配键`}
                    onChange={(e) => c.updateScope(row.name, { keyText: e.target.value })}
                  />
                ),
              },
            ]}
          />
          <p className="hint">删除与高风险结构变更默认不选中，在差异预览中逐项确认。</p>
          <p className="hint">
            业务键匹配保留目标主键，不自动映射关联表
            ID。已有表的字段定义或顺序变化时，请先同步结构，再重新比较数据。
          </p>
        </Panel>
        <Panel title="同步模板">
          <p className="hint">复用常用连接与选表规则</p>
          {templates.map((t) => (
            <button className="template-card" key={t.id} onClick={() => void c.applyTemplate(t)}>
              <FileOutlined />
              <strong>{t.name}</strong>
              <span>
                {t.tables.length} 张表 · {t.targets.length} 个目标库
              </span>
            </button>
          ))}
          <Space orientation="vertical">
            <Button onClick={() => c.editTemplate()}>将当前范围保存为模板</Button>
            <Button type="text" onClick={() => c.editTemplate(templates[0])}>
              管理模板
            </Button>
          </Space>
        </Panel>
      </div>
      <Footer>
        <span className="footer-summary">
          已选 {m.scopeTables.filter((t) => t.structure || t.data).length} 张表 ·{' '}
          {m.targetKeys.length} 个目标库
        </span>
        <Button
          type="primary"
          loading={!!m.busy}
          disabled={
            !m.sourceKey ||
            !m.targetKeys.length ||
            !m.scopeTables.some((t) => t.structure || t.data)
          }
          onClick={() => void c.compare()}
        >
          开始比较
        </Button>
      </Footer>
    </>
  );
}
export function DiffPage() {
  const c = useController();
  const { m } = c;
  const plan = m.plan;
  if (!plan) return <Empty description="先选择同步范围并比较" />;
  const nodes = reviewNodes(m);
  const visible = nodes.flatMap(leaves);
  const change =
    visible.find((v) => v.id === m.currentChangeId) ||
    visible.find((v) => !v.blocked) ||
    visible[0];
  const target = plan.targets.find(
    (t) => `${t.ref.connectionId}/${t.ref.database}` === change?.targetKey,
  );
  const columnSource =
    change && plan.sourceSnapshot[change.table]?.columns.find((col) => col.name === change.label);
  const columnTarget =
    change && target?.before[change.table]?.columns.find((col) => col.name === change.label);
  return (
    <>
      <div className="source-summary">
        <DatabaseOutlined />
        <div>
          <strong>{plan.source.database}</strong>
          <small>
            {m.state.connections.find((conn) => conn.id === plan.source.connectionId)?.name}
          </small>
        </div>
        <ArrowRightOutlined />
        <DatabaseOutlined className="primary-text" />
        <div>
          <strong>{plan.targets.length} 个目标库</strong>
          <small>
            包括{' '}
            {plan.targets
              .slice(0, 3)
              .map((t) => t.ref.database)
              .join('、')}
          </small>
        </div>
        <Space className="summary-actions">
          <Button onClick={() => c.navigate('scope')}>调整同步范围</Button>
          <Button onClick={() => void c.beginSync()}>新建同步</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'export', label: '导出表结构' },
                { key: 'template', label: '保存同步模板' },
              ],
              onClick: ({ key }) => {
                if (key === 'export') void c.beginExport();
                else c.editTemplate();
              },
            }}
          >
            <Button>更多</Button>
          </Dropdown>
        </Space>
      </div>
      <div className="table-chips">
        <span>仅比较已选的 {plan.tables.length} 张表：</span>
        {plan.tables.map((t) => (
          <Tag key={t.name}>{t.name}</Tag>
        ))}
      </div>
      {plan.targets
        .filter((t) => t.error)
        .map((t) => (
          <Alert
            className="bottom-gap"
            key={`${t.ref.connectionId}/${t.ref.database}`}
            type="error"
            showIcon
            title={`${t.ref.database}：${t.error}`}
          />
        ))}
      <div className="diff-toolbar">
        <Tabs
          activeKey={m.diffTab}
          onChange={(value) => c.set('diffTab', value)}
          items={[
            { key: 'structure', label: '表结构' },
            { key: 'data', label: '基础数据' },
          ]}
        />
        <Input
          className="short-input"
          prefix={<SearchOutlined />}
          placeholder="筛选表或变更项"
          value={m.diffSearch}
          onChange={(e) => c.set('diffSearch', e.target.value)}
        />
      </div>
      <div className="diff-layout">
        <section>
          <p className="hint">
            {m.diffTab === 'data' ? '按目标库、表和数据记录分组' : '按目标库与表分组'}
          </p>
          <DataTable<ReviewNode>
            rowKey="id"
            pagination={false}
            dataSource={nodes}
            expandable={{ defaultExpandAllRows: true }}
            onRow={(row) => ({
              onClick: () => {
                if (row.change) c.set('currentChangeId', row.change.id);
              },
            })}
            columns={[
              {
                title: '对象／变更项',
                render: (_, row) => {
                  const ids = leaves(row)
                    .filter((v) => !v.blocked)
                    .map((v) => v.id);
                  return (
                    <span className="diff-object">
                      <Checkbox
                        {...selection(m.selectedIds, ids)}
                        aria-label={`选择 ${row.label}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => c.toggleChanges(ids, e.target.checked)}
                      />
                      {row.type === 'database' ? (
                        <DatabaseOutlined />
                      ) : row.type === 'table' ? (
                        <TableOutlined />
                      ) : (
                        <EditOutlined />
                      )}
                      {row.label}
                    </span>
                  );
                },
              },
              {
                title: '变更类型',
                width: 185,
                render: (_, row) =>
                  row.change ? (
                    <Space wrap size={4}>
                      <Tag
                        color={
                          row.change.blocked ? 'error' : row.change.risk ? 'warning' : 'success'
                        }
                      >
                        {kindLabels[row.change.kind] || row.change.kind}
                      </Tag>
                      {row.change.blocked ? (
                        <Tooltip title={row.change.reason}>
                          <span className="danger-text">无法执行</span>
                        </Tooltip>
                      ) : (
                        row.change.risk && <span className="warning-text">需确认</span>
                      )}
                    </Space>
                  ) : (
                    <span className="primary-text">{leaves(row).length} 项差异</span>
                  ),
              },
            ]}
          />
        </section>
        <aside className="diff-inspector">
          {change ? (
            <>
              <h2>
                {change.targetKey.split('/').slice(1).join('/')} / {change.table} / {change.label}
              </h2>
              <dl className="metadata">
                <dt>目标库</dt>
                <dd>{target?.ref.database}</dd>
                <dt>表名</dt>
                <dd>{change.table}</dd>
                <dt>变更类型</dt>
                <dd>{kindLabels[change.kind] || change.kind}</dd>
              </dl>
              {change.blocked && <Alert type="error" showIcon title={change.reason} />}
              {change.kind.endsWith('_ROW') ? (
                <>
                  <h3>字段值对比</h3>
                  <p className="hint">按唯一匹配键定位记录，保留目标库主键。</p>
                  <DataTable
                    rowKey="name"
                    pagination={false}
                    dataSource={[
                      ...new Set([...Object.keys(change.before), ...Object.keys(change.after)]),
                    ].map((name) => ({
                      name,
                      before: change.before[name],
                      after: change.after[name],
                    }))}
                    columns={[
                      { title: '字段', dataIndex: 'name' },
                      { title: '同步前', dataIndex: 'before', render: displayValue },
                      { title: '同步后', dataIndex: 'after', render: displayValue },
                    ]}
                  />
                </>
              ) : (
                (columnSource || columnTarget) && (
                  <>
                    <h3>字段定义对比</h3>
                    <div className="definition-cards">
                      {[columnTarget, columnSource].map((col, i) => (
                        <div className="definition-card" key={i}>
                          <h4>{i === 0 ? '目标库现状' : '源库定义'}</h4>
                          {col ? (
                            <dl className="metadata">
                              <dt>字段名</dt>
                              <dd>{col.name}</dd>
                              <dt>数据类型</dt>
                              <dd>{col.type}</dd>
                              <dt>允许空</dt>
                              <dd>{col.nullable ? 'YES' : 'NO'}</dd>
                              <dt>默认值</dt>
                              <dd>{col.defaultValue ?? 'NULL'}</dd>
                              <dt>注释</dt>
                              <dd>{col.comment || '—'}</dd>
                            </dl>
                          ) : (
                            <p>不存在该字段</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )
              )}
              <h3>SQL 预览</h3>
              <SqlView sql={change.sql || '-- 此项不可执行'} />
            </>
          ) : (
            <Empty description="选择变更项查看详情" />
          )}
        </aside>
      </div>
      <Footer help="同步脚本与记录自动保存；执行前准备回滚资料。">
        <label htmlFor="sync-remark">本次备注</label>
        <Input
          id="sync-remark"
          className="footer-input"
          value={m.scopeRemark}
          placeholder="填写本次变更说明"
          onChange={(e) => c.set('scopeRemark', e.target.value)}
        />
        <span>已选 {changesOf(m).filter((v) => m.selectedIds.includes(v.id)).length} 项变更</span>
        <Button
          disabled={!m.selectedIds.length || !!m.busy}
          onClick={() => void c.saveSync('SAVE_ONLY')}
        >
          仅保存记录
        </Button>
        <Button
          type="primary"
          loading={!!m.busy}
          disabled={!m.selectedIds.length}
          onClick={() => void c.saveSync('EXECUTE_AND_SAVE')}
        >
          执行并保存
        </Button>
      </Footer>
    </>
  );
}
export function RollbackPage() {
  const c = useController();
  const { m } = c;
  const rollback = m.rollback;
  if (!rollback) return <Empty description="从同步记录打开回滚预览" />;
  return (
    <>
      <Alert
        type="info"
        showIcon
        title="仅恢复已执行的变更；按逆序处理，回滚结果另存为关联记录。"
      />
      <div className="diff-layout top-gap">
        <DataTable<ReviewNode>
          rowKey="id"
          pagination={false}
          dataSource={recoveryNodes(m)}
          expandable={{ defaultExpandAllRows: true }}
          onRow={(row) => ({
            onClick: () => {
              if (row.item) c.set('rollbackSql', row.item.sql.join(';\n'));
            },
          })}
          columns={[
            {
              title: '目标库／表／恢复项',
              render: (_, row) => {
                const ids = rollbackLeaves(row)
                  .filter((i) => i.eligible)
                  .map((i) => i.id);
                return (
                  <span className="diff-object">
                    <Checkbox
                      {...selection(m.rollbackIds, ids)}
                      aria-label={`恢复 ${row.label}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => c.toggleRecovery(ids, e.target.checked)}
                    />
                    {row.type === 'database' ? (
                      <DatabaseOutlined />
                    ) : row.type === 'table' ? (
                      <TableOutlined />
                    ) : (
                      <FileOutlined />
                    )}
                    {row.label}
                  </span>
                );
              },
            },
            {
              title: '校验',
              width: 200,
              render: (_, row) =>
                row.item && (
                  <Tag color={row.item.eligible ? 'success' : 'error'}>
                    {row.item.eligible ? '校验通过' : row.item.reason}
                  </Tag>
                ),
            },
          ]}
        />
        <aside className="diff-inspector">
          <h2>回滚 SQL 预览</h2>
          <SqlView sql={m.rollbackSql} />
          {rollback.items.some((i) => !i.eligible) && (
            <Alert
              className="top-gap"
              type="error"
              showIcon
              title={`${rollback.items.filter((i) => !i.eligible).length} 项无法恢复，已禁用。`}
            />
          )}
          <p className="hint">执行前会再次校验后续修改与恢复资料；冲突项不会覆盖。</p>
        </aside>
      </div>
      <Footer>
        <label htmlFor="rollback-remark">回滚备注</label>
        <Input
          id="rollback-remark"
          className="footer-input"
          value={m.rollbackRemark}
          placeholder="填写回滚原因"
          onChange={(e) => c.set('rollbackRemark', e.target.value)}
        />
        <span>已选 {m.rollbackIds.length} 项恢复</span>
        <Button onClick={() => void c.action(() => c.openRecord(rollback.recordId))}>
          返回记录
        </Button>
        <Button
          type="primary"
          loading={!!m.busy}
          disabled={!m.rollbackIds.length}
          onClick={() => void c.executeRollback()}
        >
          执行所选回滚
        </Button>
      </Footer>
    </>
  );
}
