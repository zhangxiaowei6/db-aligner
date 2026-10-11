import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Space, Tooltip } from 'antd';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ConnectionTestResult } from '../model';

export function MenuOperationFeedback({
  result,
  label,
  retry,
}: {
  result?: ConnectionTestResult;
  label: string;
  retry: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    const row = anchor.current?.closest<HTMLElement>('[role="menuitem"]') || anchor.current;
    if (!row) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    const focus = () => setFocused(true);
    const blur = (event: FocusEvent) => {
      if (!row.contains(event.relatedTarget as Node | null)) setFocused(false);
    };
    row.addEventListener('mouseenter', enter);
    row.addEventListener('mouseleave', leave);
    row.addEventListener('focusin', focus);
    row.addEventListener('focusout', blur);
    return () => {
      row.removeEventListener('mouseenter', enter);
      row.removeEventListener('mouseleave', leave);
      row.removeEventListener('focusin', focus);
      row.removeEventListener('focusout', blur);
    };
  }, []);
  return (
    <Tooltip
      open={!!result && (hovered || focused)}
      title={
        result ? `${result.message}${result.status === 'testing' ? '' : ` · ${retry}`}` : undefined
      }
      trigger={['hover', 'focus']}
    >
      <Space
        ref={anchor}
        tabIndex={0}
        className={result ? `refresh-menu-result test-${result.status}` : undefined}
      >
        {label}
        {result?.status === 'success' ? (
          <CheckOutlined aria-hidden />
        ) : result?.status === 'error' ? (
          <CloseOutlined aria-hidden />
        ) : null}
        {result && (
          <span className="visually-hidden" role="status" aria-live="polite">
            {result.message}
          </span>
        )}
      </Space>
    </Tooltip>
  );
}
