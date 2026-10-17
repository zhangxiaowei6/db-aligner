// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { OverflowText } from './OverflowText';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses the standard focusable Tooltip only for overflowing content, and rechecks changed text', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(80);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.textContent === '完整的长文本说明' ? 200 : 40;
  });
  const view = render(<OverflowText text="完整的长文本说明" />);
  expect(screen.getByText('完整的长文本说明').getAttribute('title')).toBeNull();
  await userEvent.tab();
  expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', '完整的长文本说明');
  view.rerender(<OverflowText text="短文本" />);
  expect(
    screen.getByText('短文本', { selector: '.table-overflow-text' }).getAttribute('tabindex'),
  ).toBeNull();
});
