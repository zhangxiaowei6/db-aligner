import {
  Alert,
  Button,
  Checkbox,
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
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useController } from '../controller';
import {
  changesOf,
  dbOptions,
  kindLabels,
  leaves,
  recoveryNodes,
  reviewNodes,
  rollbackLeaves,
  selection,
  type ReviewNode,
  type ScopeTable,
} from '../model';
import { DataTable, Field, Footer, Panel, SelectionToggle } from '../components/shared';
import { DatabaseOptionsStatus } from '../components/DatabaseOptionsStatus';
import { columnChangeSummary } from '../column-comparison';
import { DiffInspector } from '../components/DiffInspector';
import SqlView from '../components/SqlView';
import {
  StructureOptionsEditor,
  TableStructureOptions,
} from '../components/StructureOptionsEditor';

export function ScopePage() {
  const c = useController();
  const { m } = c;
  const comparing = !!m.compareTask && ['RUNNING', 'CANCELLING'].includes(m.compareTask.status);
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
        <Panel title="来源与目标" className="scope-panel">
          <DatabaseOptionsStatus />
          <Form layout="vertical">
            <div className="source-target-form">
              <Field label="来源数据库">
                <Select
                  disabled={comparing}
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择来源数据库"
                  loading={Object.values(m.dbLoading).some(Boolean)}
                  value={m.sourceKey || undefined}
                  options={options}
                  onChange={(value) => void c.loadScope(value)}
                />
              </Field>
              <ArrowRightOutlined className="flow-arrow" />
              <Field label="目标数据库（可多选）">
                <Select
                  className="target-database-select"
                  disabled={comparing}
                  mode="multiple"
                  loading={Object.values(m.dbLoading).some(Boolean)}
                  optionFilterProp="label"
                  value={m.targetKeys}
                  placeholder="选择目标库"
                  options={options.filter((o) => o.value !== m.sourceKey)}
                  onChange={(keys) => void c.setTargets(keys)}
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
              {(['structure', 'data'] as const).map((kind) => {
                return (
                  <SelectionToggle
                    key={kind}
                    disabled={comparing}
                    total={filtered.length}
                    selected={filtered.filter((table) => table[kind]).length}
                    onToggle={() => c.toggleScope(kind)}
                  >
                    {kind === 'structure' ? '结构' : '数据'}
                  </SelectionToggle>
                );
              })}
            </Space>
            <span className="hint">只读取已选表的结构与数据</span>
            <Button
              size="small"
              aria-label="刷新目标表清单"
              icon={<ReloadOutlined aria-hidden />}
              disabled={comparing || !m.targetKeys.length}
              loading={m.targetKeys.some((key) => m.targetTablesLoading[key])}
              onClick={() => void c.loadTargetTables(true)}
            >
              刷新目标表清单
            </Button>
          </div>
          {m.targetKeys.some((key) => m.targetTablesLoading[key]) && (
            <p className="hint" role="status">
              正在检查目标库表清单…
            </p>
          )}
          {m.targetKeys.some((key) => m.targetTablesErrors[key]) && (
            <Alert
              className="bottom-gap"
              type="warning"
              showIcon
              title="部分目标库表清单加载失败，缺表情况尚未确认"
              description={m.targetKeys
                .filter((key) => m.targetTablesErrors[key])
                .map(
                  (key) =>
                    `${options.find((option) => option.value === key)?.label || key}：${m.targetTablesErrors[key]}`,
                )
                .join('；')}
              action={
                <Button
                  size="small"
                  aria-label="重试"
                  icon={<ReloadOutlined aria-hidden />}
                  onClick={() => void c.loadTargetTables(true)}
                >
                  重试
                </Button>
              }
            />
          )}
          <div className="structure-defaults">
            <strong>统一结构默认</strong>
            <StructureOptionsEditor
              value={m.structureDefaults}
              disabled={comparing}
              onChange={(options) => c.set('structureDefaults', options)}
            />
            <Button
              size="small"
              disabled={comparing || !m.scopeTables.some((table) => table.structure)}
              onClick={() => c.applyStructureDefaults()}
            >
              应用到当前已选结构表
            </Button>
          </div>
          <DataTable<ScopeTable>
            size="small"
            className="scope-table"
            rowKey="name"
            dataSource={filtered}
            locale={{ emptyText: '选择源库后加载表名' }}
            columns={[
              {
                title: '表名',
                key: 'name',
                width: 240,
                ellipsis: true,
                render: (_, row) => {
                  const missing = c.missingTargets(row.name);
                  return (
                    <span className="table-name-cell">
                      <TableOutlined />
                      <span title={row.name}>{row.name}</span>
                      {!!missing.length && (
                        <Tooltip
                          title={`目标库缺少该表：${missing.map((key) => `${key.slice(key.indexOf('/') + 1)}（${m.state.connections.find((item) => item.id === key.slice(0, key.indexOf('/')))?.name || key.slice(0, key.indexOf('/'))}）`).join('、')}`}
                        >
                          <Tag color="orange">目标缺失</Tag>
                        </Tooltip>
                      )}
                    </span>
                  );
                },
              },
              {
                title: '表说明',
                dataIndex: 'comment',
                width: 240,
                ellipsis: true,
                render: (value: string) => value || '无表注释',
              },
              {
                title: '表结构',
                width: 85,
                align: 'center',
                render: (_, row) => (
                  <Checkbox
                    disabled={comparing}
                    checked={row.structure}
                    aria-label={`${row.name} 表结构`}
                    onChange={(e) => c.updateScope(row.name, { structure: e.target.checked })}
                  />
                ),
              },
              {
                title: '结构细项',
                width: 130,
                render: (_, row) => (
                  <TableStructureOptions
                    label={`${row.name} 结构细项`}
                    value={row.structureOptions}
                    disabled={comparing || !row.structure}
                    onChange={(options) => c.updateScope(row.name, { structureOptions: options })}
                  />
                ),
              },
              {
                title: '基础数据',
                width: 90,
                align: 'center',
                render: (_, row) => (
                  <Checkbox
                    disabled={comparing}
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
                    disabled={comparing || !row.data}
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
            标注“目标缺失”的表勾选数据时，会自动同时勾选完整表结构：先创建表，再复制全部数据。
          </p>
          <p className="hint">
            业务键匹配保留目标主键，不自动映射关联表
            ID。已有表的字段定义或顺序变化时，请先同步结构，再重新比较数据。
          </p>
        </Panel>
        <Panel title="同步模板">
          <p className="hint">复用常用连接与选表规则</p>
          {templates.map((t) => (
            <button
              className="template-card"
              key={t.id}
              disabled={comparing}
              title={comparing ? '请先停止当前比较' : undefined}
              onClick={() => void c.applyTemplate(t)}
            >
              <FileOutlined />
              <strong>{t.name}</strong>
              <span>
                {t.tables.length} 张表 · {t.targets.length} 个目标库
              </span>
            </button>
          ))}
          <Space orientation="vertical">
            <Button onClick={() => c.editTemplate()}>将当前范围保存为模板</Button>
            <Button size="small" onClick={() => c.editTemplate(templates[0])}>
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
          loading={comparing}
          disabled={
            !m.sourceKey ||
            comparing ||
            !!m.compareConfirmation ||
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
  const flatten = (items: ReviewNode[]): ReviewNode[] =>
    items.flatMap((node) => [node, ...flatten(node.children || [])]);
  const allNodes = flatten(nodes);
  const inspected =
    allNodes.find((node) => node.id === m.currentChangeId) ||
    allNodes.find((node) => node.change && !node.change.blocked) ||
    allNodes.find((node) => node.change);
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
          <Button onClick={() => c.navigate('scope')}>上一步</Button>
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
      {plan.targets.map((target) => {
        const missing = plan.tables.filter(
          (table) => table.data && target.before[table.name]?.exists === false,
        );
        if (!missing.length) return null;
        const connection = m.state.connections.find((item) => item.id === target.ref.connectionId);
        return (
          <Alert
            className="bottom-gap missing-data-tables"
            key={`missing:${target.ref.connectionId}/${target.ref.database}`}
            type="warning"
            showIcon
            title={`${target.ref.database}${connection ? `（${connection.name}）` : ''}：目标缺少数据同步表`}
            description={
              <ul>
                {missing.map((table) => (
                  <li key={table.name}>
                    <strong>{table.name}</strong>：
                    {target.changes.some(
                      (change) =>
                        change.table === table.name &&
                        change.kind === 'CREATE_TABLE' &&
                        !change.blocked,
                    )
                      ? '同步数据前必须选中创建表操作，先建表、后写入数据。'
                      : '仅数据同步无法写入，请启用完整结构同步或先创建目标表。'}
                  </li>
                ))}
              </ul>
            }
          />
        );
      })}
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
            rowClassName={(row) => (row.id === inspected?.id ? 'diff-inspected-row' : '')}
            onRow={(row) => ({
              onClick: () => c.set('currentChangeId', row.id),
              tabIndex: 0,
              'aria-selected': row.id === inspected?.id,
              onKeyDown: (event) => {
                if (event.key === 'Enter') c.set('currentChangeId', row.id);
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
                      {row.change.kind === 'MODIFY_COLUMN' && (
                        <span className="field-change-summary">
                          {columnChangeSummary(plan, row.change)}
                        </span>
                      )}
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
          <DiffInspector
            plan={plan}
            node={inspected}
            selectedIds={m.selectedIds}
            onInspect={(change) =>
              c.commit((state) => ({
                ...state,
                currentChangeId: change.id,
                diffSearch: '',
                diffTab: change.kind.endsWith('_ROW') ? 'data' : 'structure',
              }))
            }
          />
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
