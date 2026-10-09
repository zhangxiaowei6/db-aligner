import type { Change } from './types';

export function executionScript(changes: Change[]) {
  const ordered = [
    ...changes.filter((change) => change.kind === 'CREATE_TABLE'),
    ...changes.filter((change) => change.kind !== 'CREATE_TABLE'),
  ];
  return ordered
    .map((change, index) => {
      const label = `${change.table} / ${change.label}`.replace(/[\r\n]/g, ' ');
      const sql = change.sql.trim();
      return `-- ${index + 1}. ${label}\n${sql}${sql.endsWith(';') ? '' : ';'}`;
    })
    .join('\n\n');
}

export function recordScriptFiles(files: string[], tab: string) {
  const suffix = tab === 'rollbackScripts' ? '04_rollback.sql' : '02_sync.sql';
  return files.filter(
    (file) => file.replaceAll('\\', '/').endsWith('/' + suffix) || file === suffix,
  );
}

export function defaultScriptFile(files: string[], tab: string) {
  const scripts = recordScriptFiles(files, tab);
  const preferred = tab === 'rollbackScripts' ? '04_rollback.sql' : '02_sync.sql';
  return scripts.find((file) => file.endsWith(preferred)) || scripts[0] || '';
}
