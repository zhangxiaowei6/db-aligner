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
  const suffixes =
    tab === 'rollbackScripts' ? ['04_rollback.sql', '05_rollback_local.sql'] : ['02_sync.sql'];
  const matches = files.filter((file) =>
    suffixes.includes(file.replaceAll('\\', '/').split('/').at(-1)!),
  );
  return matches.filter(
    (file) =>
      !file.endsWith('04_rollback.sql') ||
      !matches.some(
        (candidate) =>
          candidate.replaceAll('\\', '/') ===
          file.replaceAll('\\', '/').replace(/04_rollback\.sql$/, '05_rollback_local.sql'),
      ),
  );
}

export function defaultScriptFile(files: string[], tab: string) {
  const scripts = recordScriptFiles(files, tab);
  const preferred = tab === 'rollbackScripts' ? '04_rollback.sql' : '02_sync.sql';
  return scripts.find((file) => file.endsWith(preferred)) || scripts[0] || '';
}
