export const SQL_PAGE_SIZE = 32_768;
export const SQL_TOKEN_LIMIT = 2_000;

export function sqlPageCount(sql: string) {
  return Math.max(1, Math.ceil(sql.length / SQL_PAGE_SIZE));
}

function boundary(sql: string, offset: number) {
  if (offset <= 0 || offset >= sql.length) return Math.min(offset, sql.length);
  const previous = sql.charCodeAt(offset - 1);
  const next = sql.charCodeAt(offset);
  return (previous === 13 && next === 10) ||
    (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
    ? offset - 1
    : offset;
}

export function sqlPage(sql: string, page: number) {
  const current = Math.max(1, Math.min(sqlPageCount(sql), page));
  return sql.slice(
    boundary(sql, (current - 1) * SQL_PAGE_SIZE),
    boundary(sql, current * SQL_PAGE_SIZE),
  );
}

export function sqlTokens(sql: string) {
  if (sql.length > SQL_PAGE_SIZE) return undefined;
  const pattern =
    /(--[^\n]*|'(?:''|[^'])*'|`(?:``|[^`])*`|\b(?:ALTER|TABLE|ADD|COLUMN|DROP|CREATE|INDEX|UNIQUE|KEY|PRIMARY|NULL|NOT|DEFAULT|COMMENT|UPDATE|SET|WHERE|INSERT|INTO|VALUES|DELETE|FROM|SELECT|JOIN|ON|USE|ENGINE|CHARSET|VARCHAR|BIGINT|INT|AND|LIMIT|CONVERT|USING)\b)/gi;
  const tokens: { text: string; kind: string }[] = [];
  let offset = 0;
  for (const match of sql.matchAll(pattern)) {
    if (match.index > offset) tokens.push({ text: sql.slice(offset, match.index), kind: '' });
    const text = match[0];
    tokens.push({
      text,
      kind: text.startsWith('--')
        ? 'comment'
        : text.startsWith("'")
          ? 'string'
          : text.startsWith('`')
            ? 'identifier'
            : 'keyword',
    });
    if (tokens.length > SQL_TOKEN_LIMIT) return undefined;
    offset = match.index + text.length;
  }
  if (offset < sql.length) tokens.push({ text: sql.slice(offset), kind: '' });
  return tokens.length > SQL_TOKEN_LIMIT ? undefined : tokens;
}
