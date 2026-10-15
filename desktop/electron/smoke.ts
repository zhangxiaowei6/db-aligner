/** Internal release validation. Runs only with an explicit --smoke-test flag and
 * an isolated DB_ALIGNER_HOME; it never uses the normal user's configuration. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
export async function smoke(
  win: BrowserWindow,
  root: string,
  fixturePath: string,
  invoke: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const checks: string[] = [];
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  assert(
    await win.webContents.executeJavaScript(
      "typeof window.dbAligner?.invoke === 'function' && typeof window.require === 'undefined' && typeof window.process === 'undefined'",
    ),
    'isolated preload bridge',
  );
  assert(
    await win.webContents.executeJavaScript(
      'window.dbAligner.invoke("ping").then(value => value.protocol === 1)',
    ),
    'real renderer IPC through trusted main frame',
  );
  const updateState = (await invoke('updates.get')) as { enabled: boolean; status: string };
  assert(
    !updateState.enabled && updateState.status === 'disabled',
    'smoke disables real update requests',
  );
  assert(
    ((await invoke('updates.check')) as { status: string }).status === 'disabled',
    'disabled update check does not access network',
  );
  assert(
    await win.webContents.executeJavaScript(
      'window.dbAligner.invoke("engine.prepareUpdate").then(() => false, () => true)',
    ),
    'internal engine update preparation is not exposed to renderer',
  );
  assert(
    await win.webContents.executeJavaScript(
      'window.dbAligner.invoke("updates.check", {url: "https://example.invalid"}).then(() => false, () => true)',
    ),
    'renderer cannot override update source',
  );
  const drivers = (await invoke('drivers.list')) as { id: string; status: string }[];
  assert(
    drivers.some((driver) => driver.id === 'mariadb' && driver.status === 'installed'),
    'offline built-in MySQL driver',
  );
  assert(
    await win.webContents.executeJavaScript(
      'window.dbAligner.invoke("drivers.install", {driverId:"postgresql",url:"https://example.invalid"}).then(() => false, () => true)',
    ),
    'renderer cannot override JDBC catalogue',
  );
  if (fixture.connection.databaseType === 'postgresql') {
    const before = (await invoke('drivers.get', { driverId: 'postgresql' })) as { status: string };
    assert(
      before.status === (fixture.expectCachedDriver ? 'installed' : 'missing'),
      'PostgreSQL driver cache on startup',
    );
    const installed = (await invoke('drivers.install', { driverId: 'postgresql' })) as {
      status: string;
    };
    assert(
      installed.status === 'installed',
      'pinned PostgreSQL driver installation or offline reuse',
    );
  }
  await invoke('entity.save', {
    kind: 'connection',
    value: {
      ...fixture.connection,
      id: 'smoke-connection',
      name: 'Release verification',
      workspaceIds: ['default'],
      password: fixture.password,
    },
  });
  const state = await invoke('state.load');
  assert(!JSON.stringify(state).includes(fixture.password), 'no password in renderer state');
  const imported = (await invoke('imports.parse', {
    format: 'dbeaver',
    content: JSON.stringify({
      connections: {
        test: {
          name: 'Import verification',
          provider: 'mysql',
          configuration: {
            host: '127.0.0.1',
            port: '3306',
            user: 'root',
            password: fixture.password,
            database: fixture.source,
          },
        },
      },
    }),
  })) as unknown;
  assert(
    !JSON.stringify(imported).includes(fixture.password),
    'import credentials remain in main process',
  );
  const encrypted = await fs.readFile(path.join(root, 'credentials.json'), 'utf8');
  assert(!encrypted.includes(fixture.password), 'system-encrypted password file');
  const connected = (await invoke('connections.test', { id: 'smoke-connection' })) as {
    ok: boolean;
  };
  assert(connected.ok, 'real packaged JDBC connection');
  const source = {
    connectionId: 'smoke-connection',
    database: fixture.source,
    ...(fixture.sourceSchema ? { schema: fixture.sourceSchema } : {}),
  };
  const target = {
    connectionId: 'smoke-connection',
    database: fixture.target,
    ...(fixture.targetSchema ? { schema: fixture.targetSchema } : {}),
  };
  if (fixture.sourceSchema) {
    const schemas = (await invoke('schemas.list', { ref: source })) as string[];
    assert(
      schemas.includes(fixture.sourceSchema) && schemas.includes(fixture.targetSchema),
      'packaged schema namespace discovery',
    );
  }
  if (fixture.mysql) {
    await invoke('entity.save', {
      kind: 'connection',
      value: {
        ...fixture.mysql,
        id: 'mysql-control',
        name: '双驱动验证',
        workspaceIds: ['default'],
      },
    });
    assert(
      ((await invoke('connections.test', { id: 'mysql-control' })) as { ok: boolean }).ok,
      'both JDBC drivers work in the same packaged process',
    );
  }
  const plan = (await invoke('sync.compare', {
    workspaceId: 'default',
    source,
    targets: [target],
    tables: [{ name: fixture.table, structure: false, data: true, keyColumns: [] }],
  })) as {
    id: string;
    targets: { changes: { id: string; blocked: boolean; after?: Record<string, unknown> }[] }[];
  };
  if (fixture.bigId) {
    const numeric = plan.targets
      .flatMap((target) => target.changes)
      .find((change) => change.after?.id === fixture.bigId);
    assert(
      numeric?.after?.amount === fixture.amount,
      'exact BIGINT and DECIMAL presentation over packaged IPC',
    );
  }
  const selected = plan.targets
    .flatMap((t) => t.changes)
    .filter((x) => !x.blocked)
    .map((x) => x.id);
  assert(selected.length > 0, 'real engine comparison');
  const saved = (await invoke('sync.save', {
    planId: plan.id,
    selectedIds: selected,
    mode: 'SAVE_ONLY',
    remark: 'Packaged validation',
  })) as { status: string; id: string };
  assert(saved.status === 'UNEXECUTED', 'save-only record');
  const executed = (await invoke('sync.save', {
    planId: plan.id,
    selectedIds: selected,
    mode: 'EXECUTE_AND_SAVE',
    remark: 'Packaged validation',
  })) as { id: string };
  let record: { status: string } | undefined;
  for (let i = 0; i < 300; i++) {
    const detail = (await invoke('record.get', { id: executed.id })) as {
      record: { status: string };
    };
    record = detail.record;
    if (!['RUNNING', 'QUEUED'].includes(record.status)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(record?.status === 'SUCCESS', 'packaged execution and archive');
  const preview = (await invoke('rollback.preview', { id: executed.id })) as {
    items: { id: string; eligible: boolean }[];
  };
  assert(
    preview.items.length === selected.length && preview.items.every((i) => i.eligible),
    'verified recovery material',
  );
  const rolled = (await invoke('rollback.execute', {
    id: executed.id,
    selectedIds: preview.items.map((i) => i.id),
    remark: 'Packaged validation',
  })) as { status: string };
  assert(rolled.status === 'SUCCESS', 'packaged rollback');
  const exportSql = (await invoke('schema.export', {
    source,
    tables: [fixture.table],
    includeDrop: false,
  })) as { sql: string };
  assert(!/\nDROP TABLE/.test(exportSql.sql), 'default schema export has no DROP');
  assert(exportSql.sql.includes(fixture.table), 'UTF-8 Chinese object names across packaged IPC');
  const exportDrop = (await invoke('schema.export', {
    source,
    tables: [fixture.table],
    includeDrop: true,
  })) as { sql: string };
  assert(exportDrop.sql.includes('DROP TABLE IF EXISTS'), 'explicit DROP export');
  const detail = (await invoke('record.get', { id: saved.id })) as { files: string[] };
  assert(
    detail.files.some((f) => f.endsWith('02_sync.sql')),
    'native archive recovery',
  );
  await fs.writeFile(
    path.join(root, 'smoke-result.json'),
    JSON.stringify({ passed: true, checks, at: new Date().toISOString() }, null, 2),
  );
}
