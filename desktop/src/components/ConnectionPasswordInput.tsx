import { Input } from 'antd';

const savedMask = '********';

/** 已存密码只用本地固定遮挡值展示；Form 和提交参数始终持有真实的新输入。 */
export function ConnectionPasswordInput({
  value = '',
  onChange,
  hasSavedPassword,
  ...props
}: {
  value?: string;
  onChange?: (value: string) => void;
  hasSavedPassword: boolean;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}) {
  const showingSaved = hasSavedPassword && !value;
  function selectSaved(input: HTMLInputElement) {
    if (showingSaved && (input.selectionStart !== 0 || input.selectionEnd !== savedMask.length))
      input.setSelectionRange(0, savedMask.length);
  }
  return (
    <Input.Password
      {...props}
      value={showingSaved ? savedMask : value}
      placeholder="请输入连接密码"
      autoComplete="new-password"
      visibilityToggle={!showingSaved && !!value}
      onFocus={(event) => selectSaved(event.target)}
      onSelect={(event) => selectSaved(event.currentTarget)}
      onBeforeInput={(event) => selectSaved(event.currentTarget)}
      onPaste={(event) => {
        if (!showingSaved) return;
        event.preventDefault();
        onChange?.(event.clipboardData.getData('text'));
      }}
      onKeyDown={(event) => {
        if (showingSaved && ['Backspace', 'Delete'].includes(event.key)) {
          event.preventDefault();
          onChange?.('');
        }
      }}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}
