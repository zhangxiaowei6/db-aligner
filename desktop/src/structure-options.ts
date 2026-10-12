import type { Change, StructureOptions } from './types';

export const structureLabels: Record<keyof StructureOptions, string> = {
  columns: '字段定义',
  columnOrder: '字段顺序',
  tableComment: '表注释',
  columnComments: '字段注释',
  indexes: '普通 / 唯一索引',
  foreignKeys: '外键',
  tableCollation: '表字符集与排序规则',
};
export const allStructureOptions: StructureOptions = {
  columns: true,
  columnOrder: true,
  tableComment: true,
  columnComments: true,
  indexes: true,
  foreignKeys: true,
  tableCollation: true,
};
export const defaultStructureOptions: StructureOptions = {
  ...allStructureOptions,
  indexes: false,
  foreignKeys: false,
  tableCollation: false,
};
export const effectiveOptions = (options?: StructureOptions) => options ?? allStructureOptions;
export const structureSummary = (options?: StructureOptions) =>
  Object.entries(effectiveOptions(options))
    .filter(([, selected]) => selected)
    .map(([key]) => structureLabels[key as keyof StructureOptions])
    .join('、') || '未选择细项';
export const fullStructure = (options?: StructureOptions) =>
  Object.values(effectiveOptions(options)).every(Boolean);
export const commentOnly = (change: Change) =>
  change.kind === 'MODIFY_COLUMN' &&
  change.changedParts?.length === 1 &&
  change.changedParts[0] === 'columnComments';
