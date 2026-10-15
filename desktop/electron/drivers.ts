import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import catalogue from '../../engine/src/main/resources/drivers.json' with { type: 'json' };

export type DriverStatus = 'missing' | 'downloading' | 'installed' | 'error' | 'cancelled';
export interface DriverState {
  id: string;
  databaseType: string;
  name: string;
  version: string;
  builtin: boolean;
  license: string;
  licenseUrl: string;
  status: DriverStatus;
  revision: number;
  bytes: number;
  message: string;
}

/** 下载源和路径仅来自随应用发布的目录；渲染进程只能选择标识。 */
export class Drivers {
  private states = new Map<string, DriverState>();
  private active = new Map<string, { abort: AbortController; promise: Promise<DriverState> }>();

  constructor(
    private root: string,
    private emit: (state: DriverState) => void,
    private download: typeof fetch = fetch,
  ) {}

  private entry(id: string) {
    const entry = catalogue.find((driver) => driver.id === id);
    if (!entry) throw new Error('不支持的驱动标识');
    return entry;
  }

  private change(id: string, patch: Partial<DriverState>) {
    const entry = this.entry(id);
    const previous = this.states.get(id);
    const state: DriverState = {
      id,
      databaseType: entry.databaseType,
      name: entry.name,
      version: entry.version,
      builtin: entry.builtin,
      license: entry.license,
      licenseUrl: entry.licenseUrl,
      status: 'missing',
      bytes: 0,
      message: '尚未安装',
      ...previous,
      ...patch,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.states.set(id, state);
    this.emit({ ...state });
    return { ...state };
  }

  private async directory(id: string) {
    const entry = this.entry(id);
    const base = path.join(this.root, 'drivers');
    const directory = path.join(base, entry.id, entry.version);
    for (const folder of [base, path.dirname(directory), directory]) {
      await fs.mkdir(folder, { recursive: true });
      if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('驱动目录包含不安全路径');
    }
    if (!(await fs.realpath(directory)).startsWith((await fs.realpath(base)) + path.sep))
      throw new Error('驱动目录不在允许范围');
    return directory;
  }

  async get(id: string) {
    const entry = this.entry(id);
    if (this.active.has(id)) return { ...this.states.get(id)! };
    let installed = entry.builtin;
    if (!entry.builtin) {
      try {
        const directory = await this.directory(id);
        installed = true;
        for (const file of entry.files) {
          const target = path.join(directory, file.name);
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20_000_000) {
            installed = false;
            break;
          }
          if (
            createHash('sha256')
              .update(await fs.readFile(target))
              .digest('hex') !== file.sha256
          )
            installed = false;
        }
      } catch {
        installed = false;
      }
    }
    const previous = this.states.get(id);
    if (installed)
      return this.change(id, { status: 'installed', message: '驱动已安装，可离线使用' });
    if (previous?.status === 'error' || previous?.status === 'cancelled') return { ...previous };
    return this.change(id, { status: 'missing', message: '尚未安装' });
  }

  list() {
    return Promise.all(catalogue.map((entry) => this.get(entry.id)));
  }

  install(id: string): Promise<DriverState> {
    this.entry(id);
    const pending = this.active.get(id);
    if (pending) return pending.promise;
    const abort = new AbortController();
    this.change(id, { status: 'downloading', bytes: 0, message: '正在下载驱动' });
    const promise = this.get(id)
      .then((current) => {
        if (current.status === 'installed') return current;
        this.change(id, { status: 'downloading', bytes: 0, message: '正在下载驱动' });
        return this.perform(id, abort.signal);
      })
      .finally(() => this.active.delete(id));
    this.active.set(id, { abort, promise });
    return promise;
  }

  private async perform(id: string, signal: AbortSignal) {
    let temporary: string | undefined;
    try {
      const entry = this.entry(id);
      if (!entry.builtin) {
        const directory = await this.directory(id);
        for (const file of entry.files) {
          const response = await this.download(file.url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
            redirect: 'error',
          });
          if (!response.ok || !response.body) throw new Error('驱动下载失败');
          temporary = path.join(directory, '.' + randomUUID() + '.tmp');
          const hash = createHash('sha256');
          let bytes = 0;
          const handle = await fs.open(temporary, 'wx');
          try {
            const reader = response.body.getReader();
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              const chunk = next.value;
              signal.throwIfAborted();
              bytes += chunk.length;
              if (bytes > 20_000_000) throw new Error('驱动文件超过允许大小');
              hash.update(chunk);
              let offset = 0;
              while (offset < chunk.length) {
                const written = await handle.write(chunk, offset, chunk.length - offset);
                offset += written.bytesWritten;
              }
              this.change(id, { bytes, message: '正在下载并校验驱动' });
            }
            await handle.sync();
          } finally {
            await handle.close();
          }
          signal.throwIfAborted();
          if (hash.digest('hex') !== file.sha256) throw new Error('驱动文件摘要不匹配，请重试');
          await fs.rename(temporary, path.join(directory, file.name));
          temporary = undefined;
        }
      }
      signal.throwIfAborted();
      return this.change(id, { status: 'installed', message: '驱动已安装，可测试连接' });
    } catch (error) {
      return this.change(id, {
        status: signal.aborted ? 'cancelled' : 'error',
        message: signal.aborted
          ? '安装已取消'
          : error instanceof Error && error.message.startsWith('驱动')
            ? error.message
            : '驱动安装失败，请检查网络后重试',
      });
    } finally {
      if (temporary) await fs.rm(temporary, { force: true });
    }
  }

  cancel(id: string) {
    this.entry(id);
    this.active.get(id)?.abort.abort();
    return this.get(id);
  }
}
