import { AsyncButton as Button } from './AsyncButton';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { App, Pagination } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { sqlPage, sqlPageCount, sqlTokens } from '../sql-preview';

const SqlContent = memo(function SqlContent({
  sql,
  highlight,
}: {
  sql: string;
  highlight: boolean;
}) {
  const tokens = useMemo(() => (highlight ? sqlTokens(sql) : undefined), [sql, highlight]);
  return (
    <code>
      {tokens
        ? tokens.map((token, index) => (
            <span key={index} className={token.kind}>
              {token.text}
            </span>
          ))
        : sql}
    </code>
  );
});

export default memo(function SqlView({ sql }: { sql: string }) {
  const { message } = App.useApp();
  const [position, setPosition] = useState({ sql, page: 1 });
  const page = position.sql === sql ? position.page : 1;
  if (position.sql !== sql) setPosition({ sql, page: 1 });
  const pages = sqlPageCount(sql);
  const text = useMemo(() => sqlPage(sql, page), [sql, page]);
  const viewport = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (viewport.current) {
      viewport.current.scrollTop = 0;
      viewport.current.scrollLeft = 0;
    }
  }, [sql, page]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      void message.success('完整 SQL 已复制');
    } catch {
      void message.error('复制失败，请导出完整 SQL 后查看');
    }
  }
  return (
    <div className="sql-view">
      <div className="sql-toolbar">
        {pages > 1 && (
          <span className="hint" role="status">
            分页预览 · 第 {page} / {pages} 页
          </span>
        )}
        <Button size="small" icon={<CopyOutlined />} onClick={copy} aria-label="复制完整 SQL">
          复制完整 SQL
        </Button>
      </div>
      <pre ref={viewport} tabIndex={0} aria-label="SQL 内容">
        <SqlContent sql={text} highlight={pages === 1} />
      </pre>
      {pages > 1 && (
        <div className="sql-pagination">
          <span className="hint">分页仅用于阅读，语句可能跨页；复制与导出保留完整 SQL。</span>
          <Pagination
            size="small"
            current={page}
            total={pages}
            pageSize={1}
            showSizeChanger={false}
            showQuickJumper
            onChange={(next) => setPosition({ sql, page: next })}
          />
        </div>
      )}
    </div>
  );
});
