import { describe, expect, it } from 'vitest';
import { initialModel, type Model, type Page } from './model';
import { breadcrumbs } from './navigation';
import { reconcileReferences } from './resource-references';

function fixture(): Model {
  const m = initialModel();
  m.state.workspaces = [{ id: m.workspaceId, name: '项目', description: '' }];
  m.state.versions = [
    { id: 'v', workspaceId: m.workspaceId, number: 'v1', description: '', createdAt: '' },
  ];
  m.entering = { page: 'record', recordId: 'r', origin: { versionId: 'v' } };
  m.state.versionLinks = { r: 'v' };
  return m;
}
const labels = (m: Model) => breadcrumbs(m).map((item) => item.label);

describe('业务路径', () => {
  it.each<[Page, string[]]>([
    ['scope', ['新建同步']],
    ['diff', ['新建同步', '差异预览']],
    ['templates', ['同步模板']],
    ['connections', ['连接管理']],
    ['import', ['连接管理', '导入连接']],
    ['settings', ['设置']],
    ['export', ['导出表结构']],
    ['workspaces', ['工作区管理']],
  ])('covers %s with clickable current and ancestor pages', (page, path) => {
    const m = fixture();
    m.page = page;
    m.entering = undefined;
    expect(labels(m)).toEqual(['项目', ...path]);
    expect(breadcrumbs(m)[0].target).toBeUndefined();
    expect(
      breadcrumbs(m)
        .slice(1)
        .every((item) => item.target),
    ).toBe(true);
  });
  it('distinguishes history lists, version details, records and rollback', () => {
    const m = fixture();
    m.page = 'history';
    expect(labels(m)).toEqual(['项目', '同步历史', '同步记录']);
    m.historyTab = 'versions';
    expect(labels(m)).toEqual(['项目', '同步历史', '版本']);
    m.currentVersionId = 'v';
    expect(labels(m)).toEqual(['项目', '同步历史', '版本', 'v1']);
    m.page = 'record';
    expect(labels(m)).toEqual(['项目', '同步历史', '版本', 'v1', 'r']);
    m.page = 'rollback';
    expect(labels(m)).toEqual(['项目', '同步历史', '版本', 'v1', 'r', '回滚预览']);
    m.entering = { page: 'rollback', recordId: 'r' };
    expect(labels(m)).toEqual(['项目', '同步历史', '同步记录', 'r', '回滚预览']);
  });
  it('resolves names by ID and falls back when a version is deleted or a record moves', () => {
    const m = fixture();
    m.page = 'record';
    m.state.versions[0].number = 'renamed';
    expect(labels(m)).toContain('renamed');
    delete m.state.versionLinks.r;
    expect(labels(m)).toEqual(['项目', '同步历史', '同步记录', 'r']);
    m.state.versions = [];
    expect(labels(m)).toEqual(['项目', '同步历史', '同步记录', 'r']);
    m.recordOrigin = { versionId: 'v' };
    expect(reconcileReferences(m, m.state).recordOrigin).toBeUndefined();
  });
  it('uses only actual pages for PostgreSQL table details', () => {
    const m = fixture();
    m.page = 'table';
    m.entering = {
      page: 'table',
      ref: { connectionId: 'c', database: 'db', schema: 'public' },
      table: 'dict',
    };
    expect(labels(m)).toEqual(['项目', '连接管理', 'dict']);
    expect(breadcrumbs(m).at(-1)?.target).toEqual(m.entering);
  });
});
