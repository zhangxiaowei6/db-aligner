import { describe, expect, it } from 'vitest';
import { SQL_PAGE_SIZE, SQL_TOKEN_LIMIT, sqlPage, sqlPageCount, sqlTokens } from './sql-preview';

describe('bounded SQL preview', () => {
  it.each(['😀', '\r\n', '中文', "'quoted'"])(
    'preserves the original text across a page boundary containing %s',
    (separator) => {
      const sql = 'a'.repeat(SQL_PAGE_SIZE - 1) + separator + 'b'.repeat(SQL_PAGE_SIZE) + ';';
      const pages = Array.from({ length: sqlPageCount(sql) }, (_, index) =>
        sqlPage(sql, index + 1),
      );
      expect(pages.join('')).toBe(sql);
      expect(pages.every((page) => page.length <= SQL_PAGE_SIZE + 1)).toBe(true);
      if (separator === '😀') expect(pages[0].endsWith('\ud83d')).toBe(false);
      if (separator === '\r\n') expect(pages[0].endsWith('\r')).toBe(false);
    },
  );
  it('handles empty SQL, exact boundaries and a ten megabyte single line', () => {
    expect(sqlPage('', 1)).toBe('');
    expect(sqlPageCount('')).toBe(1);
    expect(sqlPageCount('a'.repeat(SQL_PAGE_SIZE))).toBe(1);
    const sql = 'x'.repeat(10 * 1024 * 1024);
    expect(sqlPageCount(sql)).toBe(320);
    expect(sqlPage(sql, 320)).toBe('x'.repeat(SQL_PAGE_SIZE));
    expect(sqlTokens(sql)).toBeUndefined();
  });
  it('preserves small SQL highlighting and stops dense highlighting at the token budget', () => {
    const sql = "-- 说明\nCREATE TABLE `测试` (`name` VARCHAR(20) DEFAULT '中文');";
    const tokens = sqlTokens(sql)!;
    expect(tokens.map((token) => token.text).join('')).toBe(sql);
    expect(tokens.map((token) => token.kind)).toContain('string');
    expect(tokens.length).toBeLessThanOrEqual(SQL_TOKEN_LIMIT);
    expect(sqlTokens('SELECT '.repeat(1_100))).toBeUndefined();
  });
});
