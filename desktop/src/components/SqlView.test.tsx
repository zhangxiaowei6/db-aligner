// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SqlView from './SqlView';
import { SQL_PAGE_SIZE } from '../sql-preview';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
});

it('renders only the current page, copies the whole script, and resets on content replacement', () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  const sql = 'a'.repeat(SQL_PAGE_SIZE) + 'last page 😀';
  const { container, rerender } = render(
    <App>
      <SqlView sql={sql} />
    </App>,
  );
  expect(container.querySelector('code')!.textContent).toBe('a'.repeat(SQL_PAGE_SIZE));
  expect(container.querySelectorAll('code span')).toHaveLength(0);
  fireEvent.click(container.querySelector('.ant-pagination-next button')!);
  expect(container.querySelector('code')!.textContent).toBe('last page 😀');
  fireEvent.click(screen.getByRole('button', { name: '复制完整 SQL' }));
  expect(copy).toHaveBeenCalledWith(sql);
  rerender(
    <App>
      <SqlView sql={'b'.repeat(SQL_PAGE_SIZE + 20)} />
    </App>,
  );
  expect(container.querySelector('code')!.textContent).toBe('b'.repeat(SQL_PAGE_SIZE));
});
