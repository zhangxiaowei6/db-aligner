// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentTransition } from './ContentTransition';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('animates identity changes without remounting inputs, and cancels interrupted motion', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  const view = render(
    <ContentTransition identity="table/a">
      <input aria-label="草稿" defaultValue="" />
    </ContentTransition>,
  );
  const input = screen.getByLabelText('草稿');
  fireEvent.change(input, { target: { value: '保留' } });
  view.rerender(
    <ContentTransition identity="table/b">
      <input aria-label="草稿" defaultValue="" />
    </ContentTransition>,
  );
  expect(screen.getByLabelText('草稿')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('保留');
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalled();
  view.rerender(
    <ContentTransition identity="table/b">
      <input aria-label="草稿" defaultValue="" />
    </ContentTransition>,
  );
  expect(animate).toHaveBeenCalledTimes(2);
});

it('respects reduced motion and avoids duplicate child animation during parent changes', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const view = render(
    <ContentTransition identity="page/a">
      <ContentTransition identity="tab/a">内容</ContentTransition>
    </ContentTransition>,
  );
  expect(animate).not.toHaveBeenCalled();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  view.rerender(
    <ContentTransition identity="page/b">
      <ContentTransition identity="tab/b">内容</ContentTransition>
    </ContentTransition>,
  );
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(
    <ContentTransition identity="page/b">
      <ContentTransition identity="tab/c">内容</ContentTransition>
    </ContentTransition>,
  );
  expect(animate).toHaveBeenCalledTimes(2);
});
