import { namespaceLabel } from '../model';
import { DatabaseCapabilities } from '../components/DatabaseCapabilities';
import { refKey } from '../model';
import { targetRefreshKey } from '../model';
import { useEffect, useMemo, useRef } from 'react';
import { AsyncButton as Button, RefreshButton } from '../components/AsyncButton';
import {
  Alert,
  Checkbox,
  Empty,
  Form,
  Input,
  Popover,
  Radio,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowRightOutlined,
  DatabaseOutlined,
  CheckSquareOutlined,
  ClearOutlined,
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
  reviewCounts,
  rollbackLeaves,
  selection,
  scopeTableMatches,
  type ReviewNode,
  type ScopeTable,
} from '../model';
import { DataTable, Field, Footer, Panel } from '../components/shared';
import { DatabaseOptionsStatus } from '../components/DatabaseOptionsStatus';
import { columnChangeSummary } from '../column-comparison';
import { DiffInspector } from '../components/DiffInspector';
import SqlView from '../components/SqlView';
import { TemplateEditor } from './Management';
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
  const options = dbOptions(m).filter((option) => option.databaseType === m.syncDatabaseType);
  const filtered = m.scopeTables.filter(
    (table) =>
      scopeTableMatches(table, m.tableSearch) &&
      (m.scopeTableFilter === 'all' || table[m.scopeMode]),
  );
  const selectedTables = m.scopeTables.filter((table) => table[m.scopeMode]);
  const templates = m.state.templates.filter((t) => t.workspaceId === m.workspaceId);
  const selectedTemplate = templates.find((t) => t.id === m.scopeTemplateId);
  const filteredSelected = filtered.filter((table) => table[m.scopeMode]).length;
  const allFilteredSelected = filtered.length > 0 && filteredSelected === filtered.length;
  const selectionLabel =
    m.scopeTableFilter === 'selected'
      ? allFilteredSelected
        ? '取消选择筛选结果'
        : '全选筛选结果'
      : m.tableSearch.trim()
        ? allFilteredSelected
          ? '取消选择搜索结果'
          : '全选搜索结果'
        : allFilteredSelected
          ? '取消全选'
          : '全选所有表';
  return (
    <>
      <div className="scope-layout">
        <Panel title="同步范围" className="scope-panel">
          <div className="scope-template-block">
            <div className="scope-template-toolbar">
              <Form layout="vertical" className="scope-template-selector">
                <Field label="选择同步模板">
                  <Select
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    placeholder={
                      templates.length ? '搜索模板名称，填入已保存的范围' : '当前工作区暂无模板'
                    }
                    value={selectedTemplate?.id}
                    disabled={comparing || !!m.applyingTemplateId || !templates.length}
                    options={templates.map((t) => ({ value: t.id, label: t.name }))}
                    onChange={(id) => c.set('scopeTemplateId', id || '')}
                  />
                </Field>
              </Form>
              <div className="scope-template-actions">
                <Button
                  icon={<FileOutlined aria-hidden />}
                  disabled={!selectedTemplate || comparing}
                  loading={!!m.applyingTemplateId}
                  onClick={() => selectedTemplate && c.applyTemplate(selectedTemplate)}
                >
                  {m.appliedTemplate?.id === selectedTemplate?.id && selectedTemplate
                    ? '再次应用模板'
                    : '应用模板'}
                </Button>
                <Button onClick={() => c.navigate('templates')}>管理模板</Button>
              </div>
            </div>
            {selectedTemplate && (
              <p className="hint template-summary">
                {selectedTemplate.name} · 来源：
                {options.find((o) => o.value === refKey(selectedTemplate.source))?.label ||
                  namespaceLabel(selectedTemplate.source)}
                {' · '}
                {selectedTemplate.targets.length} 个目标库 · {selectedTemplate.tables.length} 张表
                {selectedTemplate.description ? ` · ${selectedTemplate.description}` : ''}
              </p>
            )}
            <p className="hint">应用模板会替换下方的来源、目标和选表范围；核对后再开始比较。</p>
            {m.appliedTemplate && (
              <Alert
                type="success"
                showIcon
                title={`已应用：${m.appliedTemplate.name}`}
                description="来源、目标和选表范围已更新，核对后点击开始比较。"
                role="status"
              />
            )}
            {m.templateApplyError && <Alert type="error" showIcon title={m.templateApplyError} />}
          </div>

          <Field label="同步数据库类型">
            <Radio.Group
              aria-label="同步数据库类型"
              value={m.syncDatabaseType}
              disabled={comparing}
              options={[
                { value: 'mysql', label: 'MySQL' },
                { value: 'postgresql', label: 'PostgreSQL' },
              ]}
              onChange={(event) => c.switchDatabaseType(event.target.value)}
            />
          </Field>
          <DatabaseOptionsStatus scope="sync" />
          <Form layout="vertical">
            <div className="source-target-form">
              <Field label="来源数据库">
                <Select
                  disabled={comparing}
                  showSearch
                  optionFilterProp="label"
                  aria-label="来源数据库"
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
                  aria-label="目标数据库"
                  disabled={comparing}
                  mode="multiple"
                  loading={Object.values(m.dbLoading).some(Boolean)}
                  optionFilterProp="label"
                  value={m.targetKeys}
                  placeholder="选择目标库"
                  options={options
                    .filter((o) => o.value !== m.sourceKey)
                    .map((option) => ({
                      ...option,
                      disabled:
                        !!m.sourceKey &&
                        option.databaseType !==
                          (m.sourceKey.startsWith('pg:') ? 'postgresql' : 'mysql'),
                    }))}
                  onChange={(keys) => void c.setTargets(keys)}
                />
              </Field>
            </div>
          </Form>
          <DatabaseCapabilities namespaceKey={m.sourceKey} />
          <div className="section-heading">
            <h2>选择需要比较的表</h2>
          </div>
          <Tabs
            aria-label="同步类型"
            activeKey={m.scopeMode}
            onChange={(value) => c.setScopeMode(value as 'structure' | 'data')}
            items={[
              {
                key: 'structure',
                label: '同步结构',
                disabled: comparing || !!m.applyingTemplateId,
              },
              { key: 'data', label: '同步数据', disabled: comparing || !!m.applyingTemplateId },
            ]}
          />
          <div className="scope-toolbar">
            <span className="hint">每次只同步一种类型；两种类型分别保留选表、搜索和筛选</span>
            <RefreshButton
              key={targetRefreshKey(m)}
              size="small"
              aria-label="刷新目标表清单"
              result={m.refreshResults[targetRefreshKey(m)]}
              icon={<ReloadOutlined aria-hidden />}
              disabled={comparing || !m.targetKeys.length}
              loading={!!m.refreshing[targetRefreshKey(m)]}
              onClick={() => c.refreshTargetTables()}
            >
              刷新目标表清单
            </RefreshButton>
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
                <RefreshButton
                  key={targetRefreshKey(m, 'retry')}
                  size="small"
                  aria-label="重试"
                  result={m.refreshResults[targetRefreshKey(m, 'retry')]}
                  icon={<ReloadOutlined aria-hidden />}
                  loading={!!m.refreshing[targetRefreshKey(m, 'retry')]}
                  disabled={comparing}
                  onClick={() => c.refreshTargetTables('retry')}
                >
                  重试
                </RefreshButton>
              }
            />
          )}
          {m.scopeMode === 'structure' && (
            <div className="structure-defaults">
              <strong>统一结构默认</strong>
              <StructureOptionsEditor
                databaseType={m.syncDatabaseType}
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
          )}
          <div className="scope-table-search">
            <label htmlFor="scope-table-search">搜索表</label>
            <Input
              id="scope-table-search"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="表名或说明，表名搜索可忽略 _"
              value={m.tableSearch}
              onChange={(e) => c.set('tableSearch', e.target.value)}
            />
            <Radio.Group
              aria-label="表筛选"
              optionType="button"
              value={m.scopeTableFilter}
              options={[
                { label: '全部表', value: 'all' },
                { label: '已选表', value: 'selected' },
              ]}
              onChange={(event) => c.set('scopeTableFilter', event.target.value)}
            />
            <Button
              icon={
                allFilteredSelected ? (
                  <ClearOutlined aria-hidden />
                ) : (
                  <CheckSquareOutlined aria-hidden />
                )
              }
              disabled={comparing || !filtered.length}
              aria-pressed={allFilteredSelected}
              onClick={() => c.toggleScope(m.scopeMode)}
            >
              {selectionLabel}
            </Button>
            <span className="hint" role="status">
              显示 {filtered.length} / {m.scopeTables.length} 张表 · 当前类型已选{' '}
              {selectedTables.length} 张
            </span>
          </div>
          <DataTable<ScopeTable>
            size="small"
            className="scope-table"
            rowKey="name"
            dataSource={filtered}
            locale={{
              emptyText: !m.scopeTables.length
                ? '选择源库后加载表名'
                : m.scopeTableFilter === 'selected'
                  ? '没有符合条件的已选表，请调整搜索或切换到全部表'
                  : '没有匹配的表，请调整搜索内容',
            }}
            columns={[
              {
                key: 'selection',
                width: 64,
                align: 'center',
                title: (
                  <Checkbox
                    checked={allFilteredSelected}
                    indeterminate={filteredSelected > 0 && !allFilteredSelected}
                    disabled={comparing || !filtered.length}
                    aria-label="选择当前列表全部表"
                    onChange={() => c.toggleScope(m.scopeMode)}
                  />
                ),
                render: (_, row) => (
                  <Checkbox
                    checked={row[m.scopeMode]}
                    disabled={comparing}
                    aria-label={`${row.name} ${m.scopeMode === 'structure' ? '表结构' : '基础数据'}`}
                    onChange={(e) => c.updateScope(row.name, { [m.scopeMode]: e.target.checked })}
                  />
                ),
              },
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
                title: m.scopeMode === 'structure' ? '结构细项' : '匹配键',
                width: m.scopeMode === 'structure' ? 220 : 320,
                render: (_, row) =>
                  m.scopeMode === 'structure' ? (
                    <TableStructureOptions
                      databaseType={m.sourceKey.startsWith('pg:') ? 'postgresql' : 'mysql'}
                      label={`${row.name} 结构细项`}
                      value={row.structureOptions}
                      disabled={comparing || !row.structure}
                      onChange={(options) => c.updateScope(row.name, { structureOptions: options })}
                    />
                  ) : (
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
          {m.scopeMode === 'structure' ? (
            <p className="hint">删除与高风险结构变更默认不选中，在差异预览中逐项确认。</p>
          ) : (
            <>
              <p className="hint">
                数据同步仅处理源库与目标库都存在的同名表；目标缺表时自动跳过，不创建表。
              </p>
              <p className="hint">
                业务键匹配保留目标主键，不自动映射关联表
                ID。已有表的字段定义或顺序变化时，请先同步结构，再重新比较数据。
              </p>
              <p className="hint">
                数据量限制：源库和每个目标库的每张表最多 20,000 行；超过上限会阻止该表的数据同步，
                不会只同步前 20,000 行。工具适用于基础字典等中小规模数据， 不适合全量迁移、CDC
                或大表持续复制。
              </p>
              <p className="hint">
                多表或多目标比较会读取源库和目标库数据，增加数据库负载、网络传输和客户端内存占用；
                即使每表未超限也需注意总量。建议只选择必要表，按表分批、避开业务高峰，
                并确认源库与目标库容量、匹配键索引及网络条件；分批选表不能绕过单表行数上限。
              </p>
            </>
          )}
        </Panel>
      </div>
      <Footer>
        <span className="footer-summary">
          已选 {m.scopeTables.filter((t) => t.structure || t.data).length} 张表 ·{' '}
          {m.targetKeys.length} 个目标库
        </span>
        <Space>
          <Button
            icon={<FileOutlined aria-hidden />}
            disabled={comparing || !!m.applyingTemplateId || !m.sourceKey || !m.targetKeys.length}
            onClick={() => c.editTemplate()}
          >
            将当前范围保存为模板
          </Button>
          <Button
            type="primary"
            loading={comparing}
            disabled={
              !!m.applyingTemplateId ||
              !m.sourceKey ||
              comparing ||
              !!m.compareConfirmation ||
              !m.targetKeys.length ||
              !m.scopeTables.some((t) => t.structure || t.data)
            }
            onClick={() => c.compare()}
          >
            开始比较
          </Button>
        </Space>
      </Footer>
      <TemplateEditor />
    </>
  );
}
export function DiffPage() {
  const c = useController();
  const { m } = c;
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [m.currentChangeId, m.diffTab, m.plan?.id]);
  const plan = m.plan;
  const changes = useMemo(() => changesOf(m), [plan]);
  const modes = useMemo(
    () => new Map(plan?.tables.map((table) => [table.name, table]) || []),
    [plan],
  );
  const tabs = useMemo(
    () =>
      [
        { key: 'structure', label: '表结构' },
        { key: 'data', label: '基础数据' },
      ].filter(({ key }) =>
        changes.some((change) =>
          change.kind === 'BLOCKED'
            ? modes.get(change.table)?.[key as 'structure' | 'data']
            : (key === 'data') === change.kind.endsWith('_ROW'),
        ),
      ),
    [changes, modes],
  );
  const diffTab = tabs.find((tab) => tab.key === m.diffTab)?.key || tabs[0]?.key || m.diffTab;
  const nodes = useMemo(() => reviewNodes({ ...m, diffTab }), [plan, diffTab, m.diffSearch]);
  const selected = useMemo(() => new Set(m.selectedIds), [m.selectedIds]);
  const counts = useMemo(() => reviewCounts(nodes, selected), [nodes, selected]);
  const allNodes = useMemo(() => {
    const result: ReviewNode[] = [];
    function visit(items: ReviewNode[]) {
      for (const node of items) {
        result.push(node);
        visit(node.children || []);
      }
    }
    visit(nodes);
    return result;
  }, [nodes]);
  if (!plan) return <Empty description="先选择同步范围并比较" />;
  const inspected =
    allNodes.find((node) => node.id === m.currentChangeId) ||
    allNodes.find((node) => node.change && !node.change.blocked) ||
    allNodes.find((node) => node.change);
  return (
    <>
      <div className="diff-overview">
        <div className="source-summary">
          <DatabaseOutlined />
          <div>
            <strong>{namespaceLabel(plan.source)}</strong>
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
                .map((t) => namespaceLabel(t.ref))
                .join('、')}
            </small>
          </div>
          <Space className="summary-actions">
            <Button onClick={() => c.navigate('scope')}>上一步</Button>
          </Space>
        </div>
        <div className="table-chips">
          <span>仅比较已选的 {plan.tables.length} 张表：</span>
          {plan.tables.slice(0, 20).map((t) => (
            <Tag key={t.name}>{t.name}</Tag>
          ))}
          {plan.tables.length > 20 && (
            <Popover
              trigger="click"
              title={`已选 ${plan.tables.length} 张表`}
              content={
                <DataTable
                  rowKey="name"
                  size="small"
                  dataSource={plan.tables}
                  columns={[{ title: '表名', dataIndex: 'name', width: 240, ellipsis: true }]}
                />
              }
            >
              <Button size="small">查看全部表</Button>
            </Popover>
          )}
        </div>
        {plan.targets
          .filter((t) => t.error)
          .map((t) => (
            <Alert
              className="bottom-gap"
              key={refKey(t.ref)}
              type="error"
              showIcon
              title={`${namespaceLabel(t.ref)}：${t.error}`}
            />
          ))}
        {plan.targets.map((target) => {
          const missing = plan.tables.filter(
            (table) => table.data && target.before[table.name]?.exists === false,
          );
          if (!missing.length) return null;
          const connection = m.state.connections.find(
            (item) => item.id === target.ref.connectionId,
          );
          return (
            <Alert
              className="bottom-gap missing-data-tables"
              key={`missing:${refKey(target.ref)}`}
              type="warning"
              showIcon
              title={`${namespaceLabel(target.ref)}${connection ? `（${connection.name}）` : ''}：目标缺少数据同步表`}
              description={
                <ul>
                  {missing.map((table) => (
                    <li key={table.name}>
                      <strong>{table.name}</strong>：
                      {target.skippedTables?.includes(table.name)
                        ? '已自动跳过：目标库不存在该表。其他目标库中的同名表继续同步。'
                        : target.changes.some(
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
          {!!tabs.length && (
            <Tabs activeKey={diffTab} onChange={(value) => c.set('diffTab', value)} items={tabs} />
          )}
          <Input
            className="short-input"
            prefix={<SearchOutlined />}
            placeholder="筛选表或变更项"
            value={m.diffSearch}
            onChange={(e) => c.set('diffSearch', e.target.value)}
          />
        </div>
      </div>
      <div className="diff-layout">
        <section className={allNodes.length > 200 ? 'review-viewport' : undefined}>
          <p className="hint">
            {diffTab === 'data' ? '按目标库、表和数据记录分组' : '按目标库与表分组'}
          </p>
          <DataTable<ReviewNode>
            key={`${plan.id}/${diffTab}/${m.diffSearch}`}
            fitViewport={allNodes.length > 200}
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
                  const count = counts.get(row.id)!;
                  return (
                    <span className="diff-object">
                      <Checkbox
                        checked={count.eligible > 0 && count.selected === count.eligible}
                        indeterminate={count.selected > 0 && count.selected < count.eligible}
                        disabled={!count.eligible}
                        aria-label={`选择 ${row.label}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          c.toggleChanges(
                            leaves(row)
                              .filter((change) => !change.blocked)
                              .map((change) => change.id),
                            e.target.checked,
                          )
                        }
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
                    <span className="primary-text">{counts.get(row.id)!.total} 项差异</span>
                  ),
              },
            ]}
          />
        </section>
        <aside className="diff-inspector" ref={inspector} aria-label="差异明细" tabIndex={0}>
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
        <span>已选 {changes.filter((change) => selected.has(change.id)).length} 项变更</span>
        <Button
          disabled={!m.selectedIds.length || !!m.syncSubmitting}
          onClick={() => c.saveSync('SAVE_ONLY')}
        >
          仅保存记录
        </Button>
        <Button
          type="primary"
          disabled={!m.selectedIds.length || !!m.syncSubmitting}
          onClick={() => c.saveSync('EXECUTE_AND_SAVE')}
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
  const nodes = useMemo(() => recoveryNodes(m), [rollback]);
  const selected = useMemo(() => new Set(m.rollbackIds), [m.rollbackIds]);
  const counts = useMemo(() => reviewCounts(nodes, selected), [nodes, selected]);
  if (!rollback) return <Empty description="从同步记录打开回滚预览" />;
  return (
    <>
      <Alert
        type="info"
        showIcon
        title="仅恢复已执行的变更；按逆序处理，回滚结果另存为关联记录。"
      />
      <div className="diff-layout top-gap">
        <section className={counts.size > 200 ? 'review-viewport' : undefined}>
          <DataTable<ReviewNode>
            key={rollback.recordId}
            fitViewport={counts.size > 200}
            rowKey="id"
            pagination={false}
            dataSource={nodes}
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
                  const count = counts.get(row.id)!;
                  return (
                    <span className="diff-object">
                      <Checkbox
                        checked={count.eligible > 0 && count.selected === count.eligible}
                        indeterminate={count.selected > 0 && count.selected < count.eligible}
                        disabled={!count.eligible}
                        aria-label={`恢复 ${row.label}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          c.toggleRecovery(
                            rollbackLeaves(row)
                              .filter((item) => item.eligible)
                              .map((item) => item.id),
                            e.target.checked,
                          )
                        }
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
        </section>
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
        <Button onClick={() => c.action(() => c.openRecord(rollback.recordId))}>返回记录</Button>
        <Button
          type="primary"
          disabled={!m.rollbackIds.length || !!m.rollbackSubmitting}
          onClick={() => c.executeRollback()}
        >
          执行所选回滚
        </Button>
      </Footer>
    </>
  );
}
