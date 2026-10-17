import { Checkbox, Input, Radio, Tabs, Tag, Tooltip } from 'antd';
import {
  CheckSquareOutlined,
  ClearOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { AsyncButton as Button } from './AsyncButton';
import { DataTable } from './shared';
import { StructureOptionsEditor, TableStructureOptions } from './StructureOptionsEditor';
import { ContentTransition } from './ContentTransition';
import { OverflowText } from './OverflowText';
import { scopeTableMatches, type ScopeTable, type ScopeTableFilter } from '../model';
import type { StructureOptions } from '../types';

export type SelectableTable = ScopeTable & { sourceMissing?: boolean };

export function SyncTableSelector({
  id,
  mode,
  rows,
  search,
  filter,
  defaults,
  databaseType,
  disabled = false,
  onMode,
  onSearch,
  onFilter,
  onDefaults,
  onApplyDefaults,
  onUpdate,
  onToggle,
  missingTargets,
}: {
  id: string;
  mode: 'structure' | 'data';
  rows: SelectableTable[];
  search: string;
  filter: ScopeTableFilter;
  defaults: StructureOptions;
  databaseType: 'mysql' | 'postgresql';
  disabled?: boolean;
  onMode: (mode: 'structure' | 'data') => void;
  onSearch: (value: string) => void;
  onFilter: (value: ScopeTableFilter) => void;
  onDefaults: (value: StructureOptions) => void;
  onApplyDefaults: () => void;
  onUpdate: (name: string, value: Partial<SelectableTable>) => void;
  onToggle: () => void;
  missingTargets?: (name: string) => string[];
}) {
  const filtered = rows.filter(
    (row) => scopeTableMatches(row, search) && (filter === 'all' || row[mode]),
  );
  const selected = filtered.filter((row) => row[mode]).length;
  const all = !!filtered.length && selected === filtered.length;
  const label =
    filter === 'selected'
      ? all
        ? '取消选择筛选结果'
        : '全选筛选结果'
      : search.trim()
        ? all
          ? '取消选择搜索结果'
          : '全选搜索结果'
        : all
          ? '取消全选'
          : '全选所有表';
  const toggle = onToggle;
  return (
    <>
      <Tabs
        aria-label="同步类型"
        activeKey={mode}
        onChange={(value) => onMode(value as typeof mode)}
        items={[
          { key: 'structure', label: '同步结构', disabled },
          { key: 'data', label: '同步数据', disabled },
        ]}
      />
      <ContentTransition identity={`${id}/${mode}`}>
        {mode === 'structure' && (
          <div className="structure-defaults">
            <strong>统一结构默认</strong>
            <StructureOptionsEditor
              databaseType={databaseType}
              value={defaults}
              disabled={disabled}
              onChange={onDefaults}
            />
            <Button
              size="small"
              disabled={disabled || !rows.some((row) => row.structure)}
              onClick={onApplyDefaults}
            >
              应用到当前已选结构表
            </Button>
          </div>
        )}
        <div className="scope-table-search">
          <label htmlFor={`${id}-table-search`}>搜索表</label>
          <Input
            id={`${id}-table-search`}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="表名或说明，表名搜索可忽略 _"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <Radio.Group
            aria-label="表筛选"
            optionType="button"
            value={filter}
            options={[
              { label: '全部表', value: 'all' },
              { label: '已选表', value: 'selected' },
            ]}
            onChange={(e) => onFilter(e.target.value)}
          />
          <Button
            icon={all ? <ClearOutlined aria-hidden /> : <CheckSquareOutlined aria-hidden />}
            disabled={disabled || !filtered.length}
            aria-pressed={all}
            onClick={toggle}
          >
            {label}
          </Button>
          <span className="hint" role="status">
            显示 {filtered.length} / {rows.length} 张表 · 当前类型已选{' '}
            {rows.filter((row) => row[mode]).length} 张
          </span>
        </div>
        <DataTable<SelectableTable>
          size="small"
          className="scope-table"
          rowKey="name"
          dataSource={filtered}
          locale={{
            emptyText: !rows.length
              ? '选择源库后加载表名'
              : filter === 'selected'
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
                  checked={all}
                  indeterminate={selected > 0 && !all}
                  disabled={disabled || !filtered.length}
                  aria-label="选择当前列表全部表"
                  onChange={toggle}
                />
              ),
              render: (_, row) => (
                <Checkbox
                  checked={row[mode]}
                  disabled={disabled}
                  aria-label={`${row.name} ${mode === 'structure' ? '表结构' : '基础数据'}`}
                  onChange={(e) => onUpdate(row.name, { [mode]: e.target.checked })}
                />
              ),
            },
            {
              title: '表名',
              key: 'name',
              width: 240,
              ellipsis: true,
              render: (_, row) => (
                <span className="table-name-cell">
                  <TableOutlined />
                  <OverflowText text={row.name} />
                  {row.sourceMissing && <Tag color="error">来源已缺失</Tag>}
                  {!!missingTargets?.(row.name).length && (
                    <Tooltip title={`目标库缺少该表：${missingTargets(row.name).join('、')}`}>
                      <Tag color="orange">目标缺失</Tag>
                    </Tooltip>
                  )}
                  {row.sourceMissing && (
                    <Button
                      size="small"
                      danger
                      disabled={disabled}
                      onClick={() =>
                        onUpdate(row.name, { sourceMissing: false, structure: false, data: false })
                      }
                    >
                      移除
                    </Button>
                  )}
                </span>
              ),
            },
            {
              title: '表说明',
              dataIndex: 'comment',
              width: 240,
              ellipsis: true,
              render: (value: string) => value || '无表注释',
            },
            {
              title: mode === 'structure' ? '结构细项' : '匹配键',
              width: mode === 'structure' ? 220 : 320,
              render: (_, row) =>
                mode === 'structure' ? (
                  <TableStructureOptions
                    databaseType={databaseType}
                    label={`${row.name} 结构细项`}
                    value={row.structureOptions}
                    disabled={disabled || !row.structure}
                    onChange={(value) => onUpdate(row.name, { structureOptions: value })}
                  />
                ) : (
                  <Input
                    value={row.keyText}
                    disabled={disabled || !row.data}
                    placeholder="默认主键；复合键用逗号分隔"
                    aria-label={`${row.name} 匹配键`}
                    onChange={(e) => onUpdate(row.name, { keyText: e.target.value })}
                  />
                ),
            },
          ]}
        />
        {mode === 'structure' ? (
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
      </ContentTransition>
    </>
  );
}
