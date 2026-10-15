import { namespaceLabel } from '../model';
import { refKey } from '../model';
import { useMemo, useState, type ReactNode } from 'react';
import { Select } from 'antd';
import type { ConnectionInfo, DbRef } from '../types';
import SqlView from './SqlView';

export function ExecutionConfirmation({
  source,
  sourceLabel = '来源数据库',
  connections,
  targets,
  targetTitle,
  summary,
}: {
  source?: DbRef;
  sourceLabel?: string;
  connections: ConnectionInfo[];
  targets: { ref: DbRef; count: number; script: () => string }[];
  targetTitle: string;
  summary: ReactNode;
}) {
  const [targetKey, setTargetKey] = useState('');
  const target = targets.find((item) => refKey(item.ref) === targetKey) || targets[0];
  const script = useMemo(() => target?.script() || '', [target]);
  function database(ref: DbRef) {
    const connection = connections.find((item) => item.id === ref.connectionId);
    return (
      <div className="sync-confirm-database">
        <strong>
          {ref.database}
          {ref.schema !== undefined ? ' / ' + ref.schema : ''}
        </strong>
        <span>{connection?.name || ref.connectionId}</span>
        {connection && (
          <small>
            {connection.host}:{connection.port}
          </small>
        )}
      </div>
    );
  }
  return (
    <div className="sync-execution-confirmation">
      <section aria-label={sourceLabel}>
        <h3>{sourceLabel}</h3>
        <div className="sync-confirm-source">
          {source ? database(source) : '原记录未保留来源数据库信息'}
        </div>
      </section>
      <section aria-label="目标数据库">
        <h3>
          {targetTitle} {targets.length} 个目标数据库
        </h3>
        <ul className="sync-confirm-targets">
          {targets.map((item) => (
            <li key={refKey(item.ref)}>
              {database(item.ref)}
              <span className="sync-confirm-count">{item.count} 项变更</span>
            </li>
          ))}
        </ul>
      </section>
      {summary}
      <section aria-label="本次执行脚本" className="sync-confirm-scripts">
        <h3>本次执行脚本</h3>
        <p className="hint">切换目标库查看全部已选变更的 SQL，可分页查看并复制完整内容。</p>
        <Select
          aria-label="执行脚本目标库"
          placeholder="选择要查看脚本的目标库"
          className="script-target-select"
          value={target ? refKey(target.ref) : undefined}
          onChange={setTargetKey}
          options={targets.map((item) => ({
            value: refKey(item.ref),
            label: `${connections.find((connection) => connection.id === item.ref.connectionId)?.name || item.ref.connectionId} / ${namespaceLabel(item.ref)} · ${item.count} 项变更`,
          }))}
        />
        {target && (
          <section key={refKey(target.ref)} aria-label={`${namespaceLabel(target.ref)} 执行脚本`}>
            <h4>
              {namespaceLabel(target.ref)} · {target.count} 项变更
            </h4>
            <SqlView sql={script} />
          </section>
        )}
      </section>
    </div>
  );
}
