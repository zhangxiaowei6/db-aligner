import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Form, Table, Tag, type TableProps } from 'antd';
import { statusColor, statusLabel } from '../model';

export function Field({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  const id = useId();
  return (
    <Form.Item label={label} htmlFor={id} required={required}>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, { id })
        : children}
    </Form.Item>
  );
}
export function Panel({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
export function DataTable<T extends object>(props: TableProps<T>) {
  return (
    <Table<T>
      bordered
      size="middle"
      pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: true }}
      {...props}
    />
  );
}
export function Status({ value }: { value: string }) {
  return <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>;
}
export function Footer({ children, help }: { children: ReactNode; help?: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.getElementById('page-footer'));
  }, []);
  return host
    ? createPortal(
        <div className="action-footer">
          {help && <div className="footer-help">{help}</div>}
          <div className="footer-controls">{children}</div>
        </div>,
        host,
      )
    : null;
}
