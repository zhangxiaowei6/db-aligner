import { AsyncButton as Button } from './AsyncButton';
import { useMemo } from 'react';
import { App } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
export default function SqlView({ sql }: { sql: string }) {
  const { message } = App.useApp();
  const tokens = useMemo(
    () =>
      sql
        .split(
          /(--[^\n]*|'(?:''|[^'])*'|`(?:``|[^`])*`|\b(?:ALTER|TABLE|ADD|COLUMN|DROP|CREATE|INDEX|UNIQUE|KEY|PRIMARY|NULL|NOT|DEFAULT|COMMENT|UPDATE|SET|WHERE|INSERT|INTO|VALUES|DELETE|FROM|SELECT|JOIN|ON|USE|ENGINE|CHARSET|VARCHAR|BIGINT|INT|AND|LIMIT|CONVERT|USING)\b)/gi,
        )
        .filter(Boolean)
        .map((text) => ({
          text,
          kind: text.startsWith('--')
            ? 'comment'
            : text.startsWith("'")
              ? 'string'
              : text.startsWith('`')
                ? 'identifier'
                : /^[A-Z]+$/i.test(text)
                  ? 'keyword'
                  : '',
        })),
    [sql],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      void message.success('SQL 已复制');
    } catch {
      void message.error('复制失败，请手动选择 SQL');
    }
  }
  return (
    <div className="sql-view">
      <div className="sql-toolbar">
        <Button size="small" icon={<CopyOutlined />} onClick={() => copy()} aria-label="复制 SQL">
          复制
        </Button>
      </div>
      <pre tabIndex={0}>
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={t.kind}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
