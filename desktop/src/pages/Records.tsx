import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Progress,
  Radio,
  Select,
  Space,
  Tabs,
} from 'antd';
import { ArrowRightOutlined, FileOutlined, KeyOutlined, SearchOutlined } from '@ant-design/icons';
import { useController } from '../controller';
import { date, displayValue, modeLabel, refKey, statusLabel, statusOf } from '../model';
import { DataTable, Field, Footer, Panel, Status } from '../components/shared';
import SqlView from '../components/SqlView';
import type { Column, Step, SyncRecord, TargetResult } from '../types';

export function TablePage() {
  const c = useController();
  const { m } = c;
  const tab = m.tableTabs.find((t) => t.id === m.activeTableTab);
  if (!tab) return <Empty description="从左侧双击表名查看结构" />;
  const table = tab.model;
  const indexes = (
    <DataTable
      rowKey="name"
      dataSource={table.indexes}
      columns={[
        { title: '索引名', dataIndex: 'name' },
        {
          title: '类型',
          render: (_, row) =>
            row.name === 'PRIMARY' ? '主键' : row.unique ? '唯一索引' : '普通索引',
        },
        { title: '方法', dataIndex: 'type' },
        { title: '包含字段', render: (_, row) => row.columns.join(', ') },
        { title: '定义', dataIndex: 'definition' },
      ]}
    />
  );
  return (
    <>
      <div className="table-summary">
        <span>
          数据库 <strong>{tab.ref.database}</strong>
        </span>
        <span>
          引擎 <strong>{table.engine}</strong>
        </span>
        <span>
          字符集 <strong>{table.charset}</strong>
        </span>
        <span>
          排序规则 <strong>{table.collation}</strong>
        </span>
      </div>
      <Tabs
        activeKey={m.structureTab}
        onChange={(value) => c.set('structureTab', value)}
        items={[
          { key: 'columns', label: '字段' },
          { key: 'indexes', label: `索引（${table.indexes.length}）` },
          { key: 'foreignKeys', label: `外键（${table.foreignKeys.length}）` },
          { key: 'sql', label: '建表 SQL' },
        ]}
      />
      {m.structureTab === 'columns' ? (
        <>
          <DataTable<Column>
            rowKey="name"
            dataSource={table.columns}
            scroll={{ x: 950 }}
            columns={[
              {
                title: '字段名',
                dataIndex: 'name',
                render: (name: string) => (
                  <>
                    {table.indexes.some(
                      (i) => i.name === 'PRIMARY' && i.columns.includes(name),
                    ) && <KeyOutlined className="warning-text" />}{' '}
                    {name}
                  </>
                ),
              },
              { title: '数据类型', dataIndex: 'type' },
              {
                title: '允许空',
                dataIndex: 'nullable',
                render: (v: boolean) => (v ? 'YES' : 'NO'),
              },
              { title: '默认值', dataIndex: 'defaultValue', render: displayValue },
              { title: '额外属性', dataIndex: 'extra' },
              { title: '注释', dataIndex: 'comment' },
            ]}
          />
          <div className="two-panels">
            <Panel title="索引信息">{indexes}</Panel>
            <Panel title="表定义摘要">
              <dl className="metadata">
                <dt>表注释</dt>
                <dd>{table.comment || '—'}</dd>
                <dt>外键数量</dt>
                <dd>{table.foreignKeys.length}</dd>
                <dt>结构状态</dt>
                <dd>{table.supported ? '支持同步' : table.issues.join('；')}</dd>
              </dl>
            </Panel>
          </div>
        </>
      ) : m.structureTab === 'indexes' ? (
        indexes
      ) : m.structureTab === 'foreignKeys' ? (
        <DataTable
          rowKey="name"
          dataSource={table.foreignKeys}
          columns={[
            { title: '外键名', dataIndex: 'name' },
            { title: '引用表', dataIndex: 'referencedTable' },
            { title: '完整定义', dataIndex: 'definition' },
          ]}
        />
      ) : (
        <SqlView sql={table.createSql} />
      )}
      <p className="hint">查看结构后可从右键菜单发起同步，已打开的任务保留在原标签页。</p>
    </>
  );
}
export function HistoryPage() {
  const c = useController();
  const { m } = c;
  const versions = m.state.versions.filter((v) => v.workspaceId === m.workspaceId);
  const records = m.state.records.filter((r) => r.workspaceId === m.workspaceId);
  const filtered = records.filter(
    (r) =>
      `${r.id} ${r.remark}`.toLowerCase().includes(m.historySearch.toLowerCase()) &&
      (!m.historyFilter || statusOf(m, r) === m.historyFilter),
  );
  const version = versions.find((v) => v.id === m.currentVersionId);
  const versionRecords = records.filter((r) => m.state.versionLinks[r.id] === m.currentVersionId);
  const recordColumns = [
    {
      title: '同步记录／备注',
      render: (_: unknown, row: SyncRecord) => (
        <>
          <Button type="link" onClick={() => void c.action(() => c.openRecord(row.id))}>
            {row.id}
          </Button>
          <div>{row.remark || '未填写备注'}</div>
          <div className="secondary">{date(row.createdAt)}</div>
          {row.parentId && <div className="secondary">关联 {row.parentId}</div>}
        </>
      ),
    },
    { title: '执行方式', render: (_: unknown, row: SyncRecord) => modeLabel(m, row) },
    { title: '状态', render: (_: unknown, row: SyncRecord) => <Status value={statusOf(m, row)} /> },
    {
      title: '所属版本',
      render: (_: unknown, row: SyncRecord) =>
        versions.find((v) => v.id === m.state.versionLinks[row.id])?.number || '未标记',
    },
  ];
  return (
    <>
      <Tabs
        activeKey={m.historyTab}
        onChange={(value) => c.set('historyTab', value)}
        items={[
          { key: 'records', label: '同步记录' },
          { key: 'versions', label: '版本' },
        ]}
      />
      {m.historyTab === 'records' ? (
        <>
          <div className="section-heading">
            <Input
              className="medium-input"
              prefix={<SearchOutlined />}
              placeholder="搜索备注、记录编号"
              value={m.historySearch}
              onChange={(e) => c.set('historySearch', e.target.value)}
            />
            <Select
              className="short-input"
              allowClear
              value={m.historyFilter || undefined}
              placeholder="全部状态"
              onChange={(value) => c.set('historyFilter', value || '')}
              options={[
                'UNEXECUTED',
                'QUEUED',
                'RUNNING',
                'SUCCESS',
                'PARTIAL',
                'FAILED',
                'CANCELLED',
                'INTERRUPTED',
                'EXTERNAL_UNVERIFIED',
                'EXTERNAL_VERIFIED',
              ].map((value) => ({ value, label: statusLabel(value) }))}
            />
          </div>
          {!!m.historySelection.length && (
            <div className="selection-bar">
              <strong>已选择 {m.historySelection.length} 条同步记录</strong>
              <Space>
                <Button onClick={() => void c.exportRecords(m.historySelection)}>导出记录</Button>
                <Button type="primary" onClick={c.openVersionDrawer}>
                  标记版本
                </Button>
              </Space>
            </div>
          )}
          <DataTable<SyncRecord>
            rowKey="id"
            dataSource={filtered}
            rowSelection={{
              selectedRowKeys: m.historySelection,
              preserveSelectedRowKeys: true,
              onChange: (keys) => c.set('historySelection', keys as string[]),
            }}
            onRow={(row) => ({ onDoubleClick: () => void c.action(() => c.openRecord(row.id)) })}
            columns={recordColumns}
          />
          <p className="hint">保存记录与执行状态分别展示。点击记录查看脚本、执行结果及回滚资料。</p>
        </>
      ) : (
        <div className="version-layout">
          <section>
            {versions.map((v) => (
              <button
                key={v.id}
                className={`template-card ${v.id === m.currentVersionId ? 'selected' : ''}`}
                onClick={() => c.set('currentVersionId', v.id)}
              >
                <strong>{v.number}</strong>
                <span>{date(v.createdAt)}</span>
                <span>{v.description}</span>
                <span>
                  {records.filter((r) => m.state.versionLinks[r.id] === v.id).length} 条记录
                </span>
              </button>
            ))}
            {!versions.length && <Empty description="在同步记录中勾选多条记录后标记版本" />}
          </section>
          {version ? (
            <section>
              <div className="section-heading">
                <h2>{version.number}</h2>
                <Space wrap>
                  <Button onClick={() => void c.editVersion()}>编辑说明</Button>
                  <Button onClick={() => c.set('historyTab', 'records')}>追加记录</Button>
                  <Button
                    type="primary"
                    disabled={!versionRecords.length}
                    onClick={() =>
                      void c.exportRecords(
                        versionRecords.map((r) => r.id),
                        version.number + '-scripts.zip',
                      )
                    }
                  >
                    导出版本脚本
                  </Button>
                </Space>
              </div>
              <p>{version.description}</p>
              <p className="hint">版本用于归档多条同步记录，各记录执行状态独立保存。</p>
              <DataTable<SyncRecord>
                rowKey="id"
                dataSource={versionRecords}
                columns={recordColumns}
              />
              <h3>版本脚本包</h3>
              <p className="hint">
                按记录及目标库保留备份、同步、校验与回滚脚本，点击记录查看具体内容。
              </p>
            </section>
          ) : (
            <Empty description="选择版本查看详情" />
          )}
        </div>
      )}
    </>
  );
}
export function RecordPage() {
  const c = useController();
  const { m } = c;
  const detail = m.detail;
  if (!detail) return <Empty description="选择同步记录查看详情" />;
  const record = detail.record;
  const source = record.plan?.source || record.source;
  const changes = record.plan?.targets.flatMap((t) => t.changes) || [];
  return (
    <>
      <div className="record-summary">
        <Space wrap>
          <span>{modeLabel(m, record)}</span>
          <span>{date(record.createdAt)}</span>
          <span>
            {source?.database} →{' '}
            {record.plan?.targets.length ?? record.targetCount ?? record.results.length} 个目标库
          </span>
          <span>{record.plan?.tables.length ?? record.tables?.length ?? 0} 张表</span>
        </Space>
        <dl className="metadata top-gap">
          <dt>本次备注</dt>
          <dd>{record.remark || '—'}</dd>
          <dt>所属版本</dt>
          <dd>
            {m.state.versions.find((v) => v.id === m.state.versionLinks[record.id])?.number ||
              '未标记'}
          </dd>
        </dl>
      </div>
      {record.mode === 'SAVE_ONLY' && (
        <Alert
          type="info"
          showIcon
          title="已保存同步脚本；外部执行结果需登记与校验。导出后可在 Navicat 等工具中执行。"
        />
      )}
      {!!detail.verification?.checks?.length && (
        <Panel title="当前状态核验" className="top-gap">
          <p className="hint">{detail.verification.notice}</p>
          <DataTable
            rowKey={(row) => `${row.target || ''}/${row.table}/${row.label}`}
            dataSource={detail.verification.checks}
            columns={[
              { title: '表', dataIndex: 'table' },
              { title: '变更项', dataIndex: 'label' },
              { title: '目标当前状态', dataIndex: 'currentState' },
              { title: '恢复资料与限制', dataIndex: 'recoveryStatus' },
            ]}
          />
        </Panel>
      )}
      <Tabs
        className="top-gap"
        activeKey={m.recordTab}
        onChange={(value) => c.set('recordTab', value)}
        items={[
          { key: 'scripts', label: '脚本与恢复资料' },
          { key: 'results', label: '执行结果' },
          ...(record.mode === 'SAVE_ONLY' ? [{ key: 'external', label: '外部执行校验' }] : []),
        ]}
      />
      {m.recordTab === 'scripts' ? (
        <div className="record-script-layout">
          <Panel title="脚本包">
            <div className="file-list">
              {detail.files.map((file) => (
                <button
                  key={file}
                  className={m.fileSelected === file ? 'active' : ''}
                  onClick={() => void c.action(() => c.selectFile(file))}
                >
                  <FileOutlined />
                  {file}
                </button>
              ))}
            </div>
            {!detail.files.length && <Empty description="档案不可用或已清理" />}
          </Panel>
          <section>
            <SqlView sql={m.fileSql || '-- 选择文件查看内容'} />
            <Panel title="导出后执行流程" className="top-gap">
              <div className="export-flow">
                <span>1　执行备份步骤</span>
                <ArrowRightOutlined />
                <span>2　执行同步脚本</span>
                <ArrowRightOutlined />
                <span>3　执行校验并返回核验</span>
              </div>
              <p className="hint">
                回滚前需确认恢复资料已完成，并检查目标库后续变更。完整差异文件仅用于审阅。
              </p>
            </Panel>
          </section>
        </div>
      ) : m.recordTab === 'results' ? (
        <>
          <DataTable<TargetResult>
            rowKey={(row) => refKey(row.ref)}
            dataSource={record.results}
            expandable={{
              expandedRowRender: (row) => (
                <DataTable<Step>
                  rowKey="changeId"
                  pagination={false}
                  dataSource={row.steps}
                  columns={[
                    {
                      title: '表／变更项',
                      render: (_, step) => {
                        const change = changes.find((ch) => ch.id === step.changeId);
                        return change ? `${change.table} / ${change.label}` : step.changeId;
                      },
                    },
                    { title: '状态', render: (_, step) => <Status value={step.status} /> },
                    { title: '错误信息', dataIndex: 'error' },
                  ]}
                />
              ),
            }}
            columns={[
              { title: '目标库', render: (_, row) => row.ref.database },
              {
                title: '进度',
                width: 220,
                render: (_, row) => (
                  <Progress
                    percent={
                      row.steps.length
                        ? Math.round(
                            (row.steps.filter((s) => s.status === 'DONE').length /
                              row.steps.length) *
                              100,
                          )
                        : 0
                    }
                    status={
                      row.status === 'FAILED'
                        ? 'exception'
                        : row.status === 'SUCCESS'
                          ? 'success'
                          : undefined
                    }
                  />
                ),
              },
              { title: '状态', render: (_, row) => <Status value={row.status} /> },
              { title: '说明', dataIndex: 'error' },
            ]}
          />
          <div className="section-heading top-gap">
            <h2>执行日志</h2>
            {['RUNNING', 'QUEUED'].includes(record.status) && (
              <Button onClick={() => void c.cancelTask()}>停止后续任务</Button>
            )}
          </div>
          <div className="log-list">
            {detail.events.map((log, i) => (
              <div key={i}>
                <time>{date(log.time)}</time>
                <span>{displayValue(log.event.type)}</span>
                <span>{displayValue(log.event.table || log.event.target || '')}</span>
                <span>{displayValue(log.event.message || log.event.status || '')}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Panel>
          <div className="section-heading">
            <h2>外部执行记录</h2>
            <Button loading={!!m.busy} onClick={() => void c.verifyExternal()}>
              校验目标库与恢复资料
            </Button>
          </div>
          {detail.external.declaredAt ? (
            <>
              <dl className="metadata">
                <dt>登记时间</dt>
                <dd>{date(detail.external.declaredAt)}</dd>
                <dt>执行范围</dt>
                <dd>{detail.external.confirmedIds?.length || 0} 项变更</dd>
                <dt>用户说明</dt>
                <dd>{detail.external.remark || '—'}</dd>
                <dt>核验状态</dt>
                <dd>{detail.external.verified ? '已核验' : '待核实'}</dd>
              </dl>
              {detail.external.checks && (
                <DataTable
                  rowKey={(row) => `${row.target}/${row.table}`}
                  dataSource={detail.external.checks}
                  columns={[
                    { title: '目标库', dataIndex: 'target' },
                    { title: '表', dataIndex: 'table' },
                    { title: '校验结果', dataIndex: 'message' },
                  ]}
                />
              )}
            </>
          ) : (
            <Empty description="尚未登记外部执行" />
          )}
        </Panel>
      )}
      <Footer>
        <span className="footer-summary">原始脚本保持存档；回滚生成新的关联记录。</span>
        {record.mode === 'SAVE_ONLY' && (
          <Button onClick={() => c.set('recordTab', 'external')}>查看外部校验</Button>
        )}
        <Button
          disabled={
            ['UNEXECUTED', 'RUNNING', 'QUEUED'].includes(record.status) && !detail.external.verified
          }
          onClick={() => void c.beginRollback(record.id)}
        >
          回滚预览
        </Button>
      </Footer>
    </>
  );
}
export function RecordDrawers() {
  const c = useController();
  const { m } = c;
  const versions = m.state.versions.filter((v) => v.workspaceId === m.workspaceId);
  const changes =
    m.detail?.record.plan?.targets
      .flatMap((t) => t.changes)
      .filter((ch) => m.detail!.record.selectedIds.includes(ch.id)) || [];
  return (
    <>
      <Drawer
        title="标记版本"
        open={m.versionDrawer}
        onClose={() => c.set('versionDrawer', false)}
        size={440}
        footer={
          <Space>
            <Button onClick={() => c.set('versionDrawer', false)}>取消</Button>
            <Button type="primary" loading={!!m.busy} onClick={() => void c.markVersion()}>
              确认标记
            </Button>
          </Space>
        }
      >
        <Radio.Group
          value={m.versionMode}
          options={[
            { label: '新建版本', value: 'new' },
            { label: '追加到已有版本', value: 'append' },
          ]}
          optionType="button"
          onChange={(e) => c.set('versionMode', e.target.value as string)}
        />
        <Form layout="vertical" className="top-gap">
          {m.versionMode === 'append' ? (
            <Field label="已有版本">
              <Select
                value={m.versionForm.id || undefined}
                options={versions.map((v) => ({ value: v.id, label: v.number }))}
                onChange={(id) => c.patch('versionForm', { id })}
              />
            </Field>
          ) : (
            <>
              <Field label="版本号">
                <Input
                  value={m.versionForm.number}
                  placeholder="例如 v1.4.0"
                  onChange={(e) => c.patch('versionForm', { number: e.target.value })}
                />
              </Field>
              <Field label="版本说明">
                <Input.TextArea
                  rows={4}
                  value={m.versionForm.description}
                  onChange={(e) => c.patch('versionForm', { description: e.target.value })}
                />
              </Field>
            </>
          )}
          <Checkbox
            checked={m.versionForm.move}
            onChange={(e) => c.patch('versionForm', { move: e.target.checked })}
          >
            将已属于其他版本的记录移动至此版本
          </Checkbox>
        </Form>
        <h3>关联记录（{m.historySelection.length} 条）</h3>
        {m.state.records
          .filter((r) => m.historySelection.includes(r.id))
          .map((r) => (
            <div className="drawer-record" key={r.id}>
              <strong>{r.id}</strong>
              <p>{r.remark}</p>
              <Status value={statusOf(m, r)} />
            </div>
          ))}
        <p className="hint">每条记录仅归属一个版本；原始脚本与执行结果保持完整。</p>
      </Drawer>
      <Drawer
        title="登记外部执行"
        open={m.externalDrawer}
        onClose={() => c.set('externalDrawer', false)}
        size={480}
        footer={
          <Space>
            <Button onClick={() => c.set('externalDrawer', false)}>取消</Button>
            <Button
              type="primary"
              loading={!!m.busy}
              disabled={!m.externalIds.length}
              onClick={() => void c.saveExternal()}
            >
              保存登记
            </Button>
          </Space>
        }
      >
        <p className="hint">登记实际执行的变更；登记后仍需校验目标库与恢复资料。</p>
        <Checkbox.Group
          className="external-choices"
          value={m.externalIds}
          onChange={(ids) => c.set('externalIds', ids as string[])}
          options={changes.map((ch) => ({
            value: ch.id,
            label: `${ch.targetKey.split('/').slice(1).join('/')} / ${ch.table} / ${ch.label}`,
          }))}
        />
        <div className="top-gap">
          <Checkbox
            checked={m.externalBackup}
            onChange={(e) => c.set('externalBackup', e.target.checked)}
          >
            已执行备份及执行后校验快照步骤
          </Checkbox>
        </div>
        <Input.TextArea
          className="top-gap"
          rows={4}
          value={m.externalRemark}
          placeholder="执行时间、工具、失败项等说明"
          onChange={(e) => c.set('externalRemark', e.target.value)}
        />
      </Drawer>
      <Drawer
        title="管理归档资料"
        open={m.cleanupDrawer}
        onClose={() => c.set('cleanupDrawer', false)}
        size={640}
      >
        <Alert
          type="warning"
          showIcon
          title="清理会永久删除本地档案，并禁用相应记录的工具内回滚。默认不自动清理。"
        />
        <div className="top-gap">
          <DataTable<SyncRecord>
            rowKey="id"
            dataSource={m.state.records}
            columns={[
              { title: '记录', dataIndex: 'id' },
              { title: '备注', dataIndex: 'remark' },
              {
                title: '操作',
                width: 80,
                render: (_, row) => (
                  <Button danger type="link" onClick={() => void c.clearArchive(row.id)}>
                    清理
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Drawer>
    </>
  );
}
