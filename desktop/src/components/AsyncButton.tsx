import { forwardRef, useEffect, useRef, useState, type ComponentRef } from 'react';
import { App, Button as AntButton, Tooltip, type ButtonProps } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ConnectionTestResult } from '../model';

export type AsyncButtonProps = Omit<ButtonProps, 'onClick'> & {
  onClick?: (event: React.MouseEvent<HTMLElement>) => unknown;
};

/** Track the actual handler promise, so loading belongs to the clicked operation. */
export const AsyncButton = forwardRef<ComponentRef<typeof AntButton>, AsyncButtonProps>(
  function AsyncButton({ onClick, loading, ...props }, ref) {
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const mounted = useRef(true);
    const { message } = App.useApp();
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    return (
      <AntButton
        {...props}
        ref={ref}
        loading={pending || loading}
        onClick={(event) => {
          if (inFlight.current || loading || props.disabled) return;
          const result = onClick?.(event);
          if (!result || typeof (result as Promise<unknown>).then !== 'function') return;
          inFlight.current = true;
          setPending(true);
          void Promise.resolve(result)
            .catch((error) => {
              if (mounted.current)
                void message.error(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
              inFlight.current = false;
              if (mounted.current) setPending(false);
            });
        }}
      />
    );
  },
);

export function RefreshButton({
  result,
  loading,
  children,
  ...props
}: AsyncButtonProps & {
  result?: ConnectionTestResult;
}) {
  const status = loading ? 'testing' : result?.status;
  return (
    <>
      <Tooltip
        title={
          result
            ? `${result.message}${result.status === 'testing' ? '' : ' · 点击再次刷新'}`
            : undefined
        }
        trigger={['hover', 'focus']}
      >
        <AsyncButton
          {...props}
          loading={loading || status === 'testing'}
          className={`connection-test-button ${status ? `test-${status}` : ''} ${props.className || ''}`}
          icon={
            status === 'success' ? (
              <CheckOutlined aria-hidden />
            ) : status === 'error' ? (
              <CloseOutlined aria-hidden />
            ) : (
              <ReloadOutlined aria-hidden />
            )
          }
          iconPlacement={status === 'success' || status === 'error' ? 'end' : 'start'}
        >
          {children}
        </AsyncButton>
      </Tooltip>
      {result && (
        <span className="visually-hidden" role="status" aria-live="polite">
          {result?.message}
        </span>
      )}
    </>
  );
}
