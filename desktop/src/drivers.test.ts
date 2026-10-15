import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Drivers } from '../electron/drivers';
import { refKey, fromKey, dbOptions, initialModel } from './model';

const roots: string[] = [];
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), 'dbaligner-drivers-'));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('maintained JDBC drivers', () => {
  it('keeps MySQL available offline and rejects arbitrary identifiers', async () => {
    const drivers = new Drivers(
      await root(),
      () => {},
      async () => {
        throw new Error('no network');
      },
    );
    expect((await drivers.get('mariadb')).status).toBe('installed');
    expect(() => drivers.install('../postgresql')).toThrow('不支持');
    expect((await drivers.install('postgresql')).status).toBe('error');
    expect((await drivers.get('postgresql')).message).not.toContain('no network');
  });
  it('deduplicates installation, rejects a corrupt JAR and cleans temporary files', async () => {
    const directory = await root();
    let downloads = 0;
    const drivers = new Drivers(
      directory,
      () => {},
      async () => {
        downloads++;
        return new Response('corrupt jar');
      },
    );
    const first = drivers.install('postgresql');
    expect(drivers.install('postgresql')).toBe(first);
    expect((await first).message).toContain('摘要');
    expect(downloads).toBe(1);
    expect(await readdir(path.join(directory, 'drivers/postgresql/42.7.8'))).toEqual([]);
    await drivers.install('postgresql');
    expect(downloads).toBe(2);
  });
  it('cancels an active download and leaves no usable driver', async () => {
    const directory = await root();
    const drivers = new Drivers(
      directory,
      () => {},
      async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options?.signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          if (signal?.aborted) reject(new Error('aborted'));
        }),
    );
    const pending = drivers.install('postgresql');
    await drivers.cancel('postgresql');
    expect((await pending).status).toBe('cancelled');
  });
  it.skipIf(!existsSync(path.resolve('..', '.tools/multi-db/postgresql-42.7.8.jar')))(
    'validates the published JAR, recognises it after restart and detects tampering',
    async () => {
      const jar = path.resolve('..', '.tools/multi-db/postgresql-42.7.8.jar');
      // 本测试读取固定制品；下载功能另由打包客户端真网络验收。
      const bytes = await readFile(jar);
      const directory = await root();
      const drivers = new Drivers(
        directory,
        () => {},
        async () => new Response(new Uint8Array(bytes)),
      );
      expect((await drivers.install('postgresql')).status).toBe('installed');
      expect((await new Drivers(directory, () => {}).get('postgresql')).status).toBe('installed');
      const offline = new Drivers(
        directory,
        () => {},
        async () => {
          throw new Error('offline');
        },
      );
      expect((await offline.install('postgresql')).status).toBe('installed');
      await writeFile(
        path.join(directory, 'drivers/postgresql/42.7.8/postgresql-42.7.8.jar'),
        'tampered',
      );
      expect((await new Drivers(directory, () => {}).get('postgresql')).status).toBe('missing');
    },
  );
  it('keeps namespace identities distinct and round trips special names', () => {
    const ref = { connectionId: 'pg', database: '库/名', schema: 'schema/"名' };
    expect(fromKey(refKey(ref))).toEqual(ref);
    expect(refKey({ connectionId: 'old', database: 'shop' })).toBe('old/shop');
    const model = initialModel();
    model.state.connections = [
      {
        id: 'pg',
        name: 'PG',
        databaseType: 'postgresql',
        databases: ['库/名'],
        workspaceIds: [model.workspaceId],
      } as never,
    ];
    model.schemaCache['pg/库/名'] = ['a', 'b'];
    expect(dbOptions(model).map((option) => fromKey(option.value).schema)).toEqual(['a', 'b']);
  });
});
