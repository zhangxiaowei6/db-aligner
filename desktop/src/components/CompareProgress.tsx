import { useEffect, useState } from 'react';
import { Alert, Button, Progress, Space } from 'antd';
import { useController } from '../controller';

export function CompareProgressPanel() {
  const c = useController();
  const task = c.m.compareTask;
  const [now, setNow] = useState(Date.now());
  const running = !!task && ['RUNNING', 'CANCELLING'].includes(task.status);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!task || !['scope', 'diff'].includes(c.m.page)) return null;
  const progress = task.progress;
  const elapsed = Math.max(
    0,
    Math.floor(((running ? now : c.m.compareFinishedAt) - c.m.compareStartedAt) / 1000),
  );
  return (
    <section className="compare-progress-panel" aria-label="比较进度">
      <Space wrap className="compare-progress-heading">
        <strong>
          {task.status === 'CANCELLING'
            ? '正在停止比较…'
            : task.status === 'CANCELLED'
              ? '比较已停止'
              : task.status === 'FAILED'
                ? '比较失败'
                : task.status === 'COMPLETED'
                  ? '比较完成'
                  : '正在比较'}
        </strong>
        <span>耗时 {elapsed} 秒</span>
        {running && (
          <Button
            danger
            size="small"
            disabled={task.status === 'CANCELLING'}
            onClick={() => void c.stopCompare()}
          >
            停止比较
          </Button>
        )}
        {!running && (
          <Button size="small" onClick={() => c.set('compareTask', undefined)}>
            收起
          </Button>
        )}
      </Space>
      <Progress
        percent={progress.total ? Math.floor((progress.completed / progress.total) * 100) : 0}
        status={
          task.status === 'RUNNING' ? 'active' : task.status === 'COMPLETED' ? 'success' : 'normal'
        }
        size="small"
      />
      <div>
        表处理进度 {progress.completed} / {progress.total} · {progress.phase}
        {progress.ref &&
          ` · ${c.m.state.connections.find((connection) => connection.id === progress.ref?.connectionId)?.name || progress.ref.connectionId} / ${progress.ref.database}`}
        {progress.table && ` / ${progress.table}`} · 当前阶段已读取 {progress.rows} 行
      </div>
      {c.m.compareTransportError && (
        <Alert type="warning" title={c.m.compareTransportError} showIcon />
      )}
      {task.error && <Alert type="error" title={task.error} showIcon />}
    </section>
  );
}
