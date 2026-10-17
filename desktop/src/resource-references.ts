import { fromKey, refKey, type Model } from './model';
import type { State } from './types';

/** Reconcile resource identities, including references that only exist in unsaved forms. */
export function reconcileReferences(s: Model, state: State): Partial<Model> {
  const exists = (
    kind: 'connections' | 'workspaces' | 'templates' | 'records' | 'versions',
    id: string,
  ) => state[kind].some((item) => item.id === id);
  const ids = (values: string[], kind: 'connections' | 'workspaces' | 'records') =>
    values.filter((id) => exists(kind, id));
  const ref = (key: string) =>
    !key ||
    state.connections.some(
      (connection) =>
        connection.id === fromKey(key).connectionId &&
        connection.workspaceIds.includes(s.workspaceId),
    );
  const groupName = (name: string) => {
    const old = s.state.connectionGroups.find((group) => group.name === name);
    return old ? state.connectionGroups.find((group) => group.id === old.id)?.name || '' : name;
  };
  const sourceLost = !!s.sourceKey && !ref(s.sourceKey);
  const targetLost = s.targetKeys.some((key) => !ref(key));
  const selectionLost = sourceLost || targetLost;
  const templateLost = !!s.templateSource && !ref(s.templateSource);
  const exportLost = !!s.exportSource && !ref(s.exportSource);
  const tableLost = s.currentTable && !ref(refKey(s.currentTable.ref));
  const detailLost = s.detail && !exists('records', s.detail.record.id);
  const rollbackLost = s.rollback && !exists('records', s.rollback.recordId);
  const remark =
    s.detail && state.records.find((record) => record.id === s.detail!.record.id)?.remark;
  return {
    importGroup: groupName(s.importGroup),
    importWorkspaceIds: ids(s.importWorkspaceIds, 'workspaces'),
    moveGroupId: state.connectionGroups.some((group) => group.id === s.moveGroupId)
      ? s.moveGroupId
      : '',
    moveConnectionId: exists('connections', s.moveConnectionId) ? s.moveConnectionId : '',
    connectionForm: {
      ...s.connectionForm,
      group: groupName(s.connectionForm.group),
      workspaceIds: ids(s.connectionForm.workspaceIds, 'workspaces'),
    },
    workspaceForm: {
      ...s.workspaceForm,
      connectionIds: ids(s.workspaceForm.connectionIds || [], 'connections'),
    },
    sourceKey: sourceLost ? '' : s.sourceKey,
    targetKeys: s.targetKeys.filter(ref),
    ...(sourceLost ? { scopeTables: [], scopeDrafts: {} } : {}),
    ...(selectionLost ? { plan: undefined, selectedIds: [], compareConfirmation: undefined } : {}),
    templateSource: templateLost ? '' : s.templateSource,
    templateTargets: s.templateTargets.filter(ref),
    ...(templateLost
      ? {
          templateForm: { ...s.templateForm, tables: [] },
          templateDrafts: {},
          templateLoading: false,
          templateError: '',
        }
      : {}),
    scopeTemplateId: exists('templates', s.scopeTemplateId) ? s.scopeTemplateId : '',
    appliedTemplate:
      s.appliedTemplate && state.templates.find((template) => template.id === s.appliedTemplate!.id)
        ? {
            ...s.appliedTemplate,
            name: state.templates.find((template) => template.id === s.appliedTemplate!.id)!.name,
          }
        : undefined,
    exportSource: exportLost ? '' : s.exportSource,
    ...(exportLost
      ? { exportTables: [], exportSql: '', exportPreview: undefined, exportGenerating: false }
      : {}),
    currentVersionId: exists('versions', s.currentVersionId) ? s.currentVersionId : '',
    recordOrigin:
      s.recordOrigin &&
      state.versions.some(
        (v) => v.id === s.recordOrigin!.versionId && v.workspaceId === s.workspaceId,
      ) &&
      state.versionLinks[
        s.page === 'rollback' ? s.rollback?.recordId || '' : s.detail?.record.id || ''
      ] === s.recordOrigin.versionId
        ? s.recordOrigin
        : undefined,
    versionForm:
      s.versionMode === 'append' && !exists('versions', s.versionForm.id)
        ? { ...s.versionForm, id: '' }
        : s.versionForm,
    detail: detailLost
      ? undefined
      : s.detail
        ? { ...s.detail, record: { ...s.detail.record, remark: remark ?? s.detail.record.remark } }
        : undefined,
    ...(detailLost
      ? {
          recordScripts: {},
          recordScriptErrors: {},
          recordScriptTargets: {},
          fileSql: '',
          fileSelected: '',
          externalDrawer: false,
        }
      : {}),
    ...(rollbackLost ? { rollback: undefined, rollbackIds: [], rollbackSql: '' } : {}),
    ...(tableLost ? { currentTable: undefined } : {}),
    page:
      selectionLost && s.page === 'diff'
        ? 'scope'
        : tableLost && s.page === 'table'
          ? 'connections'
          : (detailLost && s.page === 'record') || (rollbackLost && s.page === 'rollback')
            ? 'history'
            : s.page,
    historySelection: ids(s.historySelection, 'records'),
  };
}

export function workspaceContents(state: State, id: string) {
  return {
    connections: state.connections.filter((connection) => connection.workspaceIds.includes(id))
      .length,
    templates: state.templates.filter((template) => template.workspaceId === id).length,
    records: state.records.filter((record) => record.workspaceId === id).length,
    versions: state.versions.filter((version) => version.workspaceId === id).length,
  };
}
