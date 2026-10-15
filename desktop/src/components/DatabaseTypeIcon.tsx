import type { ConnectionInfo } from '../types';

/** 原创简化轮廓：海豚代表 MySQL，大象代表 PostgreSQL；类型文字仍由调用处保留。 */
export function DatabaseTypeIcon({
  databaseType = 'mysql',
}: {
  databaseType?: ConnectionInfo['databaseType'];
}) {
  const postgres = databaseType === 'postgresql';
  const name = postgres ? 'PostgreSQL' : 'MySQL';
  return (
    <span
      className="anticon"
      role="img"
      aria-label={`${name} 连接`}
      data-database-type={databaseType}
      style={{ fontSize: 18, verticalAlign: '-0.2em' }}
    >
      <svg
        width="1em"
        height="1em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {postgres ? (
          <>
            <path d="M8 5C4 2 1 5 2 11c.5 3 2 5 4 4l2-4M16 5c4-3 7 0 6 6-.5 3-2 5-4 4l-2-4" />
            <path d="M7 8c0-4 10-4 10 0v4l-2 3v3a3 3 0 0 1-6 0v-1h3v1c0 1 1 1 1 0v-6M7 8v4l2 3" />
            <path d="M9 9h.01M15 9h.01M6 14l2 2M18 14l-2 2" />
          </>
        ) : (
          <>
            <path d="M2 14c2-4 5-7 9-7l3-4 2 4c3 .5 5 2 6 4l-5 .5c-2 1-4 1.5-6 1.5l-2 4-2-3-2 1-3-1Z" />
            <path d="M5 14c-1 3-2 4-3 5l4-1 2 3 1-4M17 9h.01" />
          </>
        )}
      </svg>
    </span>
  );
}
