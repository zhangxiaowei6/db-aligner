import type { TableChoice } from './types';

export type SyncMode = 'structure' | 'data';

export const mixedSyncModes = (tables: TableChoice[]) =>
  tables.some((table) => table.structure) && tables.some((table) => table.data);

export const syncModeOf = (tables: TableChoice[]): SyncMode =>
  tables.some((table) => table.data) && !tables.some((table) => table.structure)
    ? 'data'
    : 'structure';

export const tablesForMode = <T extends TableChoice>(tables: T[], mode: SyncMode): T[] =>
  tables.map((table) => ({
    ...table,
    structure: mode === 'structure' && (table.structure || table.data),
    data: mode === 'data' && (table.structure || table.data),
  }));
