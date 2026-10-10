import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Spin,
} from 'antd';
import { DownloadOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useAppearance } from '../appearance';
import { useController } from '../controller';
import { api } from '../api';
import { dbOptions } from '../model';
import { DataTable, Field, Footer, Panel, SelectionToggle } from '../components/shared';
import { DatabaseOptionsStatus } from '../components/DatabaseOptionsStatus';
import SqlView from '../components/SqlView';
import type { ThemeMode } from '../types';

export function SettingsPage() {
  const c = useController();
  const { m } = c;
  const f = m.settingsForm;
  const { appearance, changeTheme } = useAppearance();
  return (
    <>
      <div className="settings-content">
        <section className="settings-section">
          <h2>同步执行</h2>
          <Form layout="vertical">
            <div className="settings-grid">
              <Field label="最大并行目标库">
                <InputNumber
                  value={f.concurrency}
                  min={1}
                  max={16}
                  precision={0}
                  onChange={(value) => {
                    if (value !== null) c.patch('settingsForm', { concurrency: value });
                  }}
                />
              </Field>
              <Field label="单服务器并行">
                <InputNumber
                  value={f.perHost}
                  min={1}
                  max={8}
                  precision={0}
                  onChange={(value) => {
                    if (value !== null) c.patch('settingsForm', { perHost: value });
                  }}
                />
              </Field>
              <Field label="数据批次大小">
                <Space>
                  <InputNumber
                    value={f.batchSize}
                    min={1}
                    max={5000}
                    precision={0}
                    onChange={(value) => {
                      if (value !== null) c.patch('settingsForm', { batchSize: value });
                    }}
                  />
                  <span>行</span>
                </Space>
              </Field>
            </div>
          </Form>
          <p className="hint">提高并发前可先在少量目标库验证。</p>
        </section>
        <section className="settings-section">
          <h2>记录与恢复资料</h2>
          <Form layout="vertical">
            <Field label="档案目录">
              <Space.Compact block>
                <Input
                  value={f.archivePath}
                  onChange={(e) => c.patch('settingsForm', { archivePath: e.target.value })}
                />
                <Button icon={<FolderOpenOutlined />} onClick={() => void c.selectDirectory()}>
                  选择目录
                </Button>
                <Button onClick={() => void c.action(() => api('files.openArchives'))}>
                  打开目录
                </Button>
              </Space.Compact>
            </Field>
            <Field label="保留策略">
              <Select
                value="forever"
                disabled
                options={[{ value: 'forever', label: '永久保留' }]}
                style={{ width: 220 }}
              />
            </Field>
            <Field label="本地配置与记录">
              <Space wrap>
                <Button onClick={() => void c.backupLocal()}>导出备份</Button>
                <Button onClick={() => void c.restoreLocal()}>导入备份</Button>
              </Space>
            </Field>
            <Field label="管理归档资料">
              <Space wrap>
                <Button onClick={() => c.set('cleanupDrawer', true)}>管理已归档资料</Button>
                <span className="hint">清理后相应记录将无法回滚。</span>
              </Space>
            </Field>
          </Form>
          <p className="hint">
            已有记录继续使用原位置，新记录保存到所选目录。连接密码由系统加密管理，不包含在配置或备份导出中。
          </p>
        </section>
        <section className="settings-section">
          <h2>外观</h2>
          <Form layout="vertical">
            <Field label="主题">
              <Segmented<ThemeMode>
                aria-label="主题"
                value={appearance.themeMode}
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' },
                  { value: 'system', label: '跟随系统' },
                ]}
                onChange={(mode) => void c.action(() => changeTheme(mode))}
              />
            </Field>
          </Form>
          <p className="hint">
            主题选择立即生效并自动保存。当前外观：
            {appearance.resolvedTheme === 'dark' ? '深色' : '浅色'}。
          </p>
        </section>
        <section className="settings-section">
          <h2>关于</h2>
          <p>Data Sync · 桌面数据库同步工具 · 开源许可 Apache-2.0</p>
          <p className="hint">
            数据库驱动、Java 运行时及其他依赖的许可见项目 THIRD_PARTY_NOTICES.md。
          </p>
        </section>
      </div>
      <Footer>
        <Button type="primary" loading={!!m.busy} onClick={() => void c.saveSettings()}>
          保存设置
        </Button>
      </Footer>
    </>
  );
}
export function ExportPage() {
  const c = useController();
  const { m } = c;
  const selectedCount = m.exportTables.filter((t) => t.selected).length;
  return (
    <>
      <div className="export-layout">
        <Panel title="导出范围" className="export-scope">
          <DatabaseOptionsStatus />
          <Form layout="vertical">
            <Field label="来源数据库">
              <Select
                value={m.exportSource || undefined}
                showSearch
                optionFilterProp="label"
                options={dbOptions(m)}
                onChange={(source) => void c.loadExport(source)}
              />
            </Field>
          </Form>
          <div className="export-table-scroll" tabIndex={0} aria-label="导出表列表">
            <DataTable
              rowKey="name"
              dataSource={m.exportTables}
              rowSelection={{
                selectedRowKeys: m.exportTables.filter((t) => t.selected).map((t) => t.name),
                preserveSelectedRowKeys: true,
                onChange: (keys) => c.selectExport(keys as string[]),
              }}
              columns={[
                { title: '表名', dataIndex: 'name', ellipsis: true },
                { title: '备注', dataIndex: 'comment', ellipsis: true },
              ]}
            />
          </div>
          <div className="export-selection-bar">
            <SelectionToggle
              total={m.exportTables.length}
              selected={selectedCount}
              onToggle={(checked) =>
                c.selectExport(checked ? m.exportTables.map((t) => t.name) : [])
              }
            >
              全选
            </SelectionToggle>
            <span className="hint">已选 {selectedCount} 张表</span>
          </div>
        </Panel>
        <section className="export-preview-column">
          <Panel title="导出选项">
            <Segmented
              value={m.includeDrop ? 'drop' : 'create'}
              options={[
                { value: 'create', label: '仅 CREATE TABLE' },
                { value: 'drop', label: '包含 DROP TABLE' },
              ]}
              onChange={(value) => c.setIncludeDrop(value === 'drop')}
            />
            <p className={m.includeDrop ? 'danger-text' : 'hint'}>
              默认不包含 DROP；开启后会在建表前生成 DROP TABLE IF EXISTS，执行会删除已有表及数据。
            </p>
            {m.includeDrop && (
              <Alert type="warning" showIcon title="文件含删除语句，执行前请核对目标数据库。" />
            )}
            <Form layout="vertical" className="top-gap">
              <div className="form-pair">
                <Field label="文件名">
                  <Input
                    value={m.exportFilename}
                    onChange={(e) => c.set('exportFilename', e.target.value)}
                  />
                </Field>
                <Field label="编码／范围">
                  <span>UTF-8 · 仅表结构</span>
                </Field>
              </div>
            </Form>
            <p className="hint">
              不含 DROP 时，目标已有同名表会导致 CREATE TABLE 报错，请先检查结构。
            </p>
          </Panel>
          <section className="export-preview" aria-label="SQL 预览" aria-busy={m.exportGenerating}>
            <div className="section-heading">
              <h2>SQL 预览</h2>
              <Space wrap>
                <span className="hint">
                  {m.exportPreview ? '已生成预览 · ' : ''}
                  {(m.exportPreview?.includeDrop ?? m.includeDrop) ? '包含 DROP' : '不含 DROP'} ·
                  不含表数据
                </span>
                <Button
                  aria-label="生成预览 SQL"
                  disabled={
                    !m.exportSource || !selectedCount || m.loading || !!m.busy || m.exportGenerating
                  }
                  loading={m.exportGenerating}
                  onClick={() => void c.updateExport()}
                >
                  {m.exportGenerating ? '正在生成…' : '生成预览 SQL'}
                </Button>
              </Space>
            </div>
            {m.exportGenerating && (
              <div className="export-generation-status" role="status">
                <Spin size="small" />
                <span>正在读取所选表结构并生成 SQL，请稍候…</span>
              </div>
            )}
            <SqlView
              sql={
                m.exportSql ||
                (m.exportGenerating
                  ? '-- 正在生成结构 SQL…'
                  : selectedCount
                    ? '-- 点击“生成预览 SQL”生成结构 SQL'
                    : '-- 请选择表后，点击“生成预览 SQL”')
              }
            />
          </section>
        </section>
      </div>
      <Footer>
        <span className="footer-summary">仅生成文件，不执行数据库操作。</span>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!m.exportSql || !!m.busy}
          loading={!!m.busy}
          onClick={() => void c.saveSql()}
        >
          导出 .sql
        </Button>
      </Footer>
    </>
  );
}
