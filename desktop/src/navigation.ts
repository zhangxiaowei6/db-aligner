import { pageTitles, type Model, type Page } from './model';
import type { DbRef } from './types';

export type RecordOrigin = { versionId: string };
export type NavigationTarget =
  | { page: Exclude<Page, 'history' | 'record' | 'rollback' | 'table'> }
  | { page: 'history'; tab?: 'records' | 'versions'; versionId?: string }
  | { page: 'record' | 'rollback'; recordId: string; origin?: RecordOrigin }
  | { page: 'table'; ref: DbRef; table: string };

export interface BreadcrumbItem {
  key: string;
  label: string;
  target?: NavigationTarget;
}

/** 页面层级集中在这里声明；不把访问历史或无独立页面的树节点拼入路径。 */
export function breadcrumbs(m: Model): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    {
      key: 'workspace',
      label: m.state.workspaces.find((w) => w.id === m.workspaceId)?.name || '工作区',
    },
  ];
  const add = (label: string, target: NavigationTarget, key = JSON.stringify(target)) =>
    items.push({ key, label, target });
  const pending = m.entering;
  const page = m.page;
  if (page === 'scope' || page === 'diff') {
    add(pageTitles.scope, { page: 'scope' });
    if (page === 'diff') add(pageTitles.diff, { page: 'diff' });
  } else if (page === 'history' || page === 'record' || page === 'rollback') {
    add(pageTitles.history, { page: 'history' });
    const recordId =
      pending?.page === 'record' || pending?.page === 'rollback'
        ? pending.recordId
        : page === 'rollback'
          ? m.rollback?.recordId
          : m.detail?.record.id;
    const origin =
      pending?.page === 'record' || pending?.page === 'rollback' ? pending.origin : m.recordOrigin;
    const versionId = page === 'history' ? m.currentVersionId : origin?.versionId;
    const version = m.state.versions.find(
      (v) => v.id === versionId && v.workspaceId === m.workspaceId,
    );
    const versionBranch =
      page === 'history'
        ? m.historyTab === 'versions'
        : !!version && !!recordId && m.state.versionLinks[recordId] === version.id;
    if (versionBranch) {
      add('版本', { page: 'history', tab: 'versions' });
      if (version) add(version.number, { page: 'history', tab: 'versions', versionId: version.id });
    } else add('同步记录', { page: 'history', tab: 'records' });
    if (page !== 'history' && recordId) {
      const validOrigin = versionBranch && version ? { versionId: version.id } : undefined;
      add(recordId, { page: 'record', recordId, origin: validOrigin }, 'record');
      if (page === 'rollback')
        add(pageTitles.rollback, { page: 'rollback', recordId, origin: validOrigin });
    }
  } else if (page === 'table' || page === 'import') {
    add(pageTitles.connections, { page: 'connections' });
    if (page === 'import') add(pageTitles.import, { page: 'import' });
    else {
      const table = pending?.page === 'table' ? pending : m.currentTable;
      if (table) add(table.table, { page: 'table', ref: table.ref, table: table.table }, 'table');
    }
  } else add(pageTitles[page], { page });
  return items;
}
