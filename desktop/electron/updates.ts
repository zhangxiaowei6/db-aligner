import type { UpdateState } from '../src/types.js';

export interface UpdatePort {
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
}

export function newerStable(candidate: string, current: string) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(candidate) || !stable.test(current)) return false;
  const a = candidate.split('.').map(BigInt);
  const b = current.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export class Updates {
  private state: UpdateState;
  private checking?: Promise<UpdateState>;
  private downloading?: Promise<UpdateState>;

  constructor(
    private port: UpdatePort,
    version: string,
    enabled: boolean,
    private emit: (state: UpdateState) => void,
    private installUpdate: () => Promise<void>,
  ) {
    this.state = {
      version,
      enabled,
      revision: 0,
      status: enabled ? 'idle' : 'disabled',
      message: enabled ? '尚未检查更新' : '当前运行方式不支持自动更新，请使用正式安装版',
    };
    port.on('update-available', (info: { version: string }) => {
      if (this.state.status !== 'checking') return;
      if (newerStable(info.version, version))
        this.set({
          status: 'available',
          nextVersion: info.version,
          message: '发现新版本，可确认下载',
        });
      else this.set({ status: 'current', nextVersion: undefined, message: '当前已是最新正式版本' });
    });
    port.on('update-not-available', () => {
      if (this.state.status === 'checking')
        this.set({ status: 'current', nextVersion: undefined, message: '当前已是最新正式版本' });
    });
    port.on('download-progress', (progress: { percent: number }) => {
      if (this.state.status === 'downloading')
        this.set({
          percent: Math.max(0, Math.min(100, progress.percent)),
          message: '正在下载更新',
        });
    });
    port.on('update-downloaded', (info: { version: string }) => {
      if (this.state.status === 'downloading' && info.version === this.state.nextVersion)
        this.set({
          status: 'downloaded',
          percent: 100,
          message: '下载完成，任务结束后可确认重启安装',
        });
    });
    port.on('error', () => {
      this.set({
        status: 'error',
        message: '更新失败，请检查网络或稍后重试；也可手动下载正式安装包',
      });
    });
  }

  get() {
    return { ...this.state };
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.emit(this.get());
  }

  check(): Promise<UpdateState> {
    if (!this.state.enabled) return Promise.resolve(this.get());
    if (this.checking) return this.checking;
    if (['downloading', 'downloaded', 'installing'].includes(this.state.status))
      return Promise.resolve(this.get());
    this.set({
      status: 'checking',
      message: '正在检查更新',
      nextVersion: undefined,
      percent: undefined,
    });
    this.checking = Promise.resolve()
      .then(() => this.port.checkForUpdates())
      .catch(() => this.set({ status: 'error', message: '无法检查更新，请检查网络或稍后重试' }))
      .then(() => this.get())
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }

  download(): Promise<UpdateState> {
    if (this.downloading) return this.downloading;
    if (this.state.status !== 'available') return Promise.reject(new Error('请先检查并发现新版本'));
    this.set({ status: 'downloading', percent: 0, message: '正在下载更新' });
    this.downloading = Promise.resolve()
      .then(() => this.port.downloadUpdate())
      .catch(() => this.set({ status: 'error', message: '更新下载或校验失败，请重新检查后重试' }))
      .then(() => this.get())
      .finally(() => {
        this.downloading = undefined;
      });
    return this.downloading;
  }

  async install() {
    if (this.state.status !== 'downloaded') throw new Error('请先下载并校验更新');
    this.set({ status: 'installing', message: '正在确认任务状态并准备安装' });
    try {
      await this.installUpdate();
    } catch (error) {
      this.set({
        status: 'downloaded',
        message: error instanceof Error ? error.message : '暂时无法安装更新',
      });
      throw error;
    }
    return this.get();
  }
}
