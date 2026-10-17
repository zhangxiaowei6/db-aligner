import { AsyncButton as Button } from './AsyncButton';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ThHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Form, Space, Table, Tag, Tooltip, type ButtonProps, type TableProps } from 'antd';
import { CheckOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons';
import { statusColor, statusLabel, type ConnectionTestResult } from '../model';
import { OverflowText } from './OverflowText';

export function SelectionToggle({
  total,
  selected,
  onToggle,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & {
  total: number;
  selected: number;
  onToggle: (checked: boolean) => void;
}) {
  const checked = total > 0 && selected === total;
  const partial = selected > 0 && !checked;
  return (
    <Button
      {...props}
      size={props.size || 'small'}
      disabled={!total || props.disabled}
      type={checked ? 'primary' : 'default'}
      aria-pressed={checked}
      icon={checked ? <CheckOutlined /> : partial ? <MinusOutlined /> : undefined}
      title={partial ? '部分选中，点击全选' : checked ? '点击取消全部选择' : '点击全选'}
      onClick={() => onToggle(!checked)}
    >
      {children}
    </Button>
  );
}

export function ConnectionTestButton({
  result,
  successDetails = false,
  ...props
}: ButtonProps & { result?: ConnectionTestResult; successDetails?: boolean }) {
  const showDetails = successDetails && result?.status === 'success';
  const button = (
    <Button
      {...props}
      className={`connection-test-button ${result ? `test-${result.status}` : ''} ${props.className || ''}`}
      loading={result?.status === 'testing'}
      title={
        !showDetails && (result?.status === 'success' || result?.status === 'error')
          ? '再次测试连接'
          : undefined
      }
      icon={
        result?.status === 'success' ? (
          <CheckOutlined />
        ) : result?.status === 'error' ? (
          <CloseOutlined />
        ) : undefined
      }
      iconPlacement="end"
    >
      测试连接
    </Button>
  );
  return showDetails ? (
    <Tooltip title={`${result.message} · 点击再次测试`} trigger={['hover', 'focus']}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
export function ConnectionTestFeedback({
  result,
  hideSuccess = false,
}: {
  result?: ConnectionTestResult;
  hideSuccess?: boolean;
}) {
  return result ? (
    <div
      role="status"
      aria-live="polite"
      className={
        hideSuccess && result.status !== 'error'
          ? 'visually-hidden'
          : `connection-test-feedback test-${result.status}`
      }
    >
      {result.message}
    </div>
  ) : null;
}

export function Field({
  label,
  children,
  required = false,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  let bound = false;
  function bind(child: ReactNode): ReactNode {
    if (!isValidElement(child) || bound) return child;
    const element = child as ReactElement<{
      id?: string;
      children?: ReactNode;
      'aria-required'?: boolean;
      'aria-label'?: string;
    }>;
    if (element.type === Space || element.type === Space.Compact) {
      return cloneElement(element, {}, Children.map(element.props.children, bind));
    }
    bound = true;
    return cloneElement(element, {
      id,
      'aria-required': required,
      'aria-label': element.props['aria-label'] || label,
    });
  }
  return (
    <Form.Item
      label={label}
      htmlFor={id}
      required={required}
      className={compact ? 'compact-field' : undefined}
    >
      {Array.isArray(children) ? Children.map(children, bind) : bind(children)}
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
type ResizeHeaderProps = ThHTMLAttributes<HTMLTableCellElement> & {
  columnWidth?: number;
  columnLabel?: string;
  onResizeColumn?: (width: number) => void;
};
function ResizeHeader({
  columnWidth,
  columnLabel,
  onResizeColumn,
  children,
  ...props
}: ResizeHeaderProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <th {...props}>
      {children}
      {onResizeColumn && (
        <span
          className="column-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整${columnLabel || '列'}宽度`}
          aria-valuemin={64}
          aria-valuemax={4000}
          aria-valuenow={Math.round(columnWidth || 64)}
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            drag.current = {
              x: event.clientX,
              width: event.currentTarget.parentElement!.getBoundingClientRect().width,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current)
              onResizeColumn(
                Math.max(64, Math.min(4000, drag.current.width + event.clientX - drag.current.x)),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              event.stopPropagation();
              onResizeColumn(
                Math.max(
                  64,
                  Math.min(4000, (columnWidth || 64) + (event.key === 'ArrowRight' ? 16 : -16)),
                ),
              );
            }
          }}
        />
      )}
    </th>
  );
}
export function DataTable<T extends object>({
  fitViewport = false,
  ...props
}: TableProps<T> & { fitViewport?: boolean }) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [lastResized, setLastResized] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setAvailableWidth(Math.floor(bounds.width));
      if (fitViewport) {
        const headerHeight =
          element.querySelector('.ant-table-thead')?.getBoundingClientRect().height || 48;
        setViewportHeight(Math.max(80, Math.floor(bounds.height - headerHeight - 4)));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitViewport]);
  const utilityWidth =
    (props.rowSelection ? Number(props.rowSelection.columnWidth) || 48 : 0) +
    (props.expandable?.expandedRowRender ? Number(props.expandable.columnWidth) || 48 : 0);
  let baseWidth = utilityWidth;
  let flexibleCount = 0;
  const leafKeys: string[] = [];
  function measure(columns: NonNullable<TableProps<T>['columns']>, path = '') {
    columns.forEach((column, index) => {
      const key = `${path}/${String(column.key ?? ('dataIndex' in column ? column.dataIndex : undefined) ?? index)}`;
      if ('children' in column) return measure(column.children, key);
      leafKeys.push(key);
      const base = typeof column.width === 'number' ? column.width : 180;
      baseWidth += widths[key] ?? base;
      if (widths[key] === undefined && base > 100 && column.key !== 'actions') flexibleCount++;
    });
  }
  measure(props.columns || []);
  // Only unedited content columns absorb spare space; a dragged column keeps its requested width.
  const spare = Math.max(0, availableWidth - baseWidth - 2);
  const fallbackKeys =
    flexibleCount === 0
      ? leafKeys.filter((key) => leafKeys.length === 1 || key !== lastResized)
      : [];
  let totalWidth = 0;
  function resizeColumns(
    columns: NonNullable<TableProps<T>['columns']>,
    path = '',
  ): typeof columns {
    return columns.map((column, index) => {
      const key = `${path}/${String(column.key ?? ('dataIndex' in column ? column.dataIndex : undefined) ?? index)}`;
      if ('children' in column) return { ...column, children: resizeColumns(column.children, key) };
      const base = typeof column.width === 'number' ? column.width : 180;
      const flexible = widths[key] === undefined && base > 100 && column.key !== 'actions';
      const width =
        (widths[key] ?? base) +
        (flexible
          ? spare / flexibleCount
          : fallbackKeys.includes(key)
            ? spare / fallbackKeys.length
            : 0);
      totalWidth += width;
      return {
        ...column,
        title:
          typeof column.title === 'string' ? <OverflowText text={column.title} /> : column.title,
        ellipsis: column.ellipsis ? { showTitle: false } : undefined,
        render: (value, record, rowIndex) => {
          const rendered = column.render ? column.render(value, record, rowIndex) : value;
          return typeof rendered === 'string' || typeof rendered === 'number' ? (
            <OverflowText text={rendered} />
          ) : (
            rendered
          );
        },
        width,
        onHeaderCell: (current) => ({
          ...column.onHeaderCell?.(current),
          columnWidth: width,
          columnLabel: typeof column.title === 'string' ? column.title : undefined,
          onResizeColumn: (next: number) => {
            setLastResized(key);
            setWidths((old) => ({ ...old, [key]: next }));
          },
        }),
      };
    });
  }
  const columns = resizeColumns(props.columns || []);
  totalWidth += utilityWidth;
  return (
    <div ref={host} className={`data-table-host${fitViewport ? ' table-viewport' : ''}`}>
      <Table<T>
        bordered
        size="middle"
        pagination={{
          defaultPageSize: 20,
          hideOnSinglePage: (props.dataSource?.length || 0) <= 20,
          showSizeChanger: true,
        }}
        {...props}
        virtual={fitViewport || props.virtual}
        className={`resizable-data-table ${props.className || ''}`}
        style={{ ...props.style, '--data-table-width': `${totalWidth}px` } as CSSProperties}
        tableLayout="fixed"
        scroll={{ ...props.scroll, ...(fitViewport ? { y: viewportHeight } : {}), x: totalWidth }}
        rowSelection={props.rowSelection ? { columnWidth: 48, ...props.rowSelection } : undefined}
        expandable={props.expandable ? { columnWidth: 48, ...props.expandable } : undefined}
        columns={columns}
        components={{
          ...props.components,
          header: { ...props.components?.header, cell: ResizeHeader },
        }}
      />
    </div>
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
