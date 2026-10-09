import { Alert, Checkbox, Modal, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useController } from '../controller';
import { effectiveOptions, structureSummary } from '../structure-options';

export function CompareConfirmation() {
  const c = useController();
  const pending = c.m.compareConfirmation;
  const [accepted, setAccepted] = useState(false);
  useEffect(() => setAccepted(false), [pending]);
  if (!pending) return null;
  const tables = pending.tables.filter((table) => table.structure || table.data);
  const dataCount = tables.filter((table) => table.data).length;
  const allData = dataCount > 0 && dataCount === pending.tables.length;
  const database = (key: string) => {
    const connection = c.m.state.connections.find(
      (item) => item.id === key.slice(0, key.indexOf('/')),
    );
    return (
      <span>
        <strong>{key.slice(key.indexOf('/') + 1)}</strong> · {connection?.name || key.split('/')[0]}
        {connection && (
          <small>
            {' '}
            · {connection.host}:{connection.port}
          </small>
        )}
      </span>
    );
  };
  return (
    <Modal
      open
      title="确认比较范围"
      width={760}
      okText="确认并开始比较"
      cancelText="取消"
      okButtonProps={{ disabled: dataCount > 0 && !accepted }}
      onOk={() => void c.startConfirmedCompare(pending)}
      onCancel={c.dismissCompareConfirmation}
    >
      <div className="compare-confirmation">
        <p>来源：{database(pending.sourceKey)}</p>
        <div>
          目标（{pending.targetKeys.length} 个）：
          <ul>
            {pending.targetKeys.map((key) => (
              <li key={key}>{database(key)}</li>
            ))}
          </ul>
        </div>
        <p>
          结构 {tables.filter((table) => table.structure).length} 张表 · 数据 {dataCount} 张表
        </p>
        <p>统一结构默认：{structureSummary(pending.structureDefaults)}</p>
        {dataCount > 0 && (
          <Alert
            type={allData ? 'error' : 'warning'}
            showIcon
            title={
              allData
                ? `已选择源库所有表的数据 · ${pending.targetKeys.length} 个目标库`
                : '本次包含数据比较'
            }
            description="会读取源库和所选目标库的数据，可能增加数据库负载、网络传输和客户端内存占用。每表最多 20,000 行；请确认范围，运行中可随时停止。"
          />
        )}
        <ul className="compare-table-list">
          {tables.map((table) => (
            <li key={table.name}>
              <strong>{table.name}</strong>
              {table.structure && (
                <div>
                  <Tag>结构</Tag>
                  {structureSummary(table.structureOptions)}
                  {JSON.stringify(effectiveOptions(table.structureOptions)) !==
                    JSON.stringify(pending.structureDefaults) && <Tag color="blue">逐表设置</Tag>}
                </div>
              )}
              {table.data && (
                <div>
                  <Tag color="orange">数据</Tag>匹配键：{table.keyText || '默认主键'}
                </div>
              )}
            </li>
          ))}
        </ul>
        {dataCount > 0 && (
          <Checkbox checked={accepted} onChange={(event) => setAccepted(event.target.checked)}>
            我已确认数据比较范围，并了解可能产生的性能影响
          </Checkbox>
        )}
      </div>
    </Modal>
  );
}
