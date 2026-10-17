import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Tooltip } from 'antd';

/** 与测试连接提示共用 Ant Design Tooltip，仅在文字实际溢出时展示。 */
export function OverflowText({
  text,
  children,
}: {
  text: string | number;
  children?: ReactElement<{ children?: ReactNode }>;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const content = String(text);
  const measure = () => {
    const node = element.current;
    if (node) setOverflow(node.scrollWidth > node.clientWidth + 1);
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [content]);
  const label = (
    <span
      ref={element}
      className="table-overflow-text"
      tabIndex={!children && overflow ? 0 : undefined}
      onMouseEnter={measure}
      onFocus={measure}
    >
      {content}
    </span>
  );
  return (
    <Tooltip
      title={overflow ? <span className="overflow-tooltip-content">{content}</span> : undefined}
      trigger={['hover', 'focus']}
    >
      {children ? cloneElement(children, { children: label }) : label}
    </Tooltip>
  );
}
