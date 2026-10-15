import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { api } from '../api';
import { fromKey } from '../model';

export function DatabaseCapabilities({ namespaceKey }: { namespaceKey: string }) {
  const [message, setMessage] = useState('');
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let current = true;
    setMessage('');
    if (!namespaceKey.startsWith('pg:')) return;
    void api<{ serverVersion: string; structure: boolean; data: boolean; recovery: boolean }>(
      'database.capabilities',
      { ref: fromKey(namespaceKey) },
    )
      .then((result) => {
        if (!current) return;
        setSupported(result.structure && result.data && result.recovery);
        setMessage(
          `${result.serverVersion}：支持普通表结构、基础数据同步与证据恢复；字段物理顺序、序列及复杂对象受限。`,
        );
      })
      .catch((error) => {
        if (current) {
          setSupported(false);
          setMessage(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      current = false;
    };
  }, [namespaceKey]);
  return message ? (
    <Alert className="bottom-gap" type={supported ? 'info' : 'warning'} showIcon title={message} />
  ) : null;
}
