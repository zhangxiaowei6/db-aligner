import { useEffect, useRef, useState } from 'react';
import { Alert, Form, Input, Modal } from 'antd';
import { useController } from '../controller';

export function RecordManagementDialogs() {
  const c = useController();
  const { m } = c;
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const session = useRef(0);
  const inFlight = useRef(false);
  const request = m.deleteRequest;
  useEffect(() => {
    session.current += 1;
    inFlight.current = false;
    setPending(false);
    setConfirmation('');
    setError('');
  }, [request, m.recordRemarkId, m.workspaceId]);
  async function submit(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const started = session.current;
    setPending(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (started === session.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (started === session.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  return (
    <>
      <Modal
        title="编辑同步记录"
        open={!!m.recordRemarkId}
        centered
        destroyOnHidden
        onCancel={() => {
          if (!pending) c.set('recordRemarkId', '');
        }}
        onOk={() => void submit(c.saveRecordRemark)}
        confirmLoading={pending}
        okText="保存"
        cancelText="取消"
        cancelButtonProps={{ disabled: pending }}
      >
        <p>{m.recordRemarkId}</p>
        <Form layout="vertical">
          <Form.Item label="备注">
            <Input.TextArea
              rows={4}
              aria-label="同步记录备注"
              placeholder="填写本次同步的备注（选填）"
              disabled={pending}
              value={m.recordRemarkText}
              onChange={(e) => c.set('recordRemarkText', e.target.value)}
            />
          </Form.Item>
        </Form>
        {error && <Alert type="error" showIcon title={error} />}
      </Modal>
      <Modal
        title={request?.kind === 'record' ? '删除同步记录及本地资料' : '删除版本'}
        open={!!request}
        centered
        destroyOnHidden
        onCancel={() => {
          if (!pending) c.set('deleteRequest', undefined);
        }}
        onOk={() => void submit(() => c.deleteHistoryEntity(confirmation))}
        confirmLoading={pending}
        okText="永久删除"
        cancelText="取消"
        cancelButtonProps={{ disabled: pending }}
        okButtonProps={{ danger: true, disabled: !request || confirmation !== request.label }}
        styles={{ body: { maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' } }}
      >
        <Alert type="warning" showIcon title={request?.label} description={request?.description} />
        {request?.context && (
          <section className="deletion-context top-gap" aria-label={request.context.label}>
            <strong>{request.context.label}</strong>
            <div className="deletion-context-text">{request.context.text}</div>
          </section>
        )}
        <Form layout="vertical" className="top-gap">
          <Form.Item
            required
            htmlFor="history-deletion-confirmation"
            label={request?.kind === 'record' ? '输入完整记录编号确认' : '输入完整版本号确认'}
          >
            <Input
              id="history-deletion-confirmation"
              aria-label="删除确认标识"
              aria-required="true"
              placeholder={
                request?.kind === 'record' ? '请输入上方完整记录编号' : '请输入上方完整版本号'
              }
              value={confirmation}
              disabled={pending}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </Form.Item>
        </Form>
        {error && <Alert type="error" showIcon title={error} />}
      </Modal>
    </>
  );
}
