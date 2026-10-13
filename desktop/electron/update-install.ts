/** Admission is frozen before checking pending requests or consulting the engine. */
export class UpdateInstallGate {
  private requests = 0;
  private frozen = false;
  private unknown = false;

  get installing() {
    return this.frozen;
  }

  async request<T>(work: () => Promise<T>): Promise<T> {
    if (this.frozen) throw new Error('客户端正在准备更新，请稍候');
    this.requests++;
    try {
      return await work();
    } finally {
      this.requests--;
    }
  }

  uncertain() {
    this.unknown = true;
  }

  engineStarted() {
    this.unknown = false;
  }

  async install(steps: {
    prepare: () => Promise<void>;
    stop: () => Promise<void>;
    launch: () => void;
    recover: () => Promise<void>;
  }) {
    if (this.frozen) throw new Error('已经在准备更新');
    this.frozen = true;
    try {
      if (this.requests || this.unknown)
        throw new Error('仍有请求正在处理或结果尚未确认，请稍后重试；状态不明时需重新启动客户端');
      await steps.prepare();
      await steps.stop();
      steps.launch();
    } catch (error) {
      try {
        await steps.recover();
        this.frozen = false;
      } catch {
        throw new Error('更新准备失败，暂时无法恢复引擎；请重新启动客户端');
      }
      throw error;
    }
  }

  async recover(work: () => Promise<void>) {
    if (!this.frozen) return;
    await work();
    this.frozen = false;
  }
}
