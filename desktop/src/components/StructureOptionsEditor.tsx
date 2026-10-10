import { AsyncButton as Button } from './AsyncButton';
import { Checkbox, Popover } from 'antd';
import type { StructureOptions } from '../types';
import { effectiveOptions, structureLabels, structureSummary } from '../structure-options';

export function StructureOptionsEditor({
  value,
  onChange,
  disabled = false,
  label = '结构细项',
}: {
  value?: StructureOptions;
  onChange: (options: StructureOptions) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="structure-options-editor" role="group" aria-label={label}>
      {(Object.keys(structureLabels) as (keyof StructureOptions)[]).map((key) => (
        <Checkbox
          key={key}
          disabled={disabled}
          checked={effectiveOptions(value)[key]}
          onChange={(event) =>
            onChange({ ...effectiveOptions(value), [key]: event.target.checked })
          }
        >
          {structureLabels[key]}
        </Checkbox>
      ))}
    </div>
  );
}
export function TableStructureOptions(props: Parameters<typeof StructureOptionsEditor>[0]) {
  return (
    <Popover trigger="click" title={props.label} content={<StructureOptionsEditor {...props} />}>
      <Button
        type="link"
        size="small"
        disabled={props.disabled}
        title={structureSummary(props.value)}
      >
        {Object.values(effectiveOptions(props.value)).filter(Boolean).length} / 7 项 · 调整
      </Button>
    </Popover>
  );
}
