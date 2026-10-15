import { AsyncButton as Button } from './AsyncButton';
import { Checkbox, Popover, Tooltip } from 'antd';
import type { StructureOptions } from '../types';
import { effectiveOptions, structureLabels, structureSummary } from '../structure-options';

export function StructureOptionsEditor({
  value,
  databaseType = 'mysql',
  onChange,
  disabled = false,
  label = '结构细项',
}: {
  databaseType?: 'mysql' | 'postgresql';
  value?: StructureOptions;
  onChange: (options: StructureOptions) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="structure-options-editor" role="group" aria-label={label}>
      {(Object.keys(structureLabels) as (keyof StructureOptions)[]).map((key) => (
        <Tooltip
          key={key}
          title={
            databaseType === 'postgresql' && ['columnOrder', 'tableCollation'].includes(key)
              ? 'PostgreSQL 不支持此结构调整'
              : undefined
          }
        >
          <Checkbox
            disabled={
              disabled ||
              (databaseType === 'postgresql' && ['columnOrder', 'tableCollation'].includes(key))
            }
            checked={
              databaseType === 'postgresql' && ['columnOrder', 'tableCollation'].includes(key)
                ? false
                : effectiveOptions(value)[key]
            }
            onChange={(event) =>
              onChange({ ...effectiveOptions(value), [key]: event.target.checked })
            }
          >
            {structureLabels[key]}
          </Checkbox>
        </Tooltip>
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
        title={structureSummary(
          props.databaseType === 'postgresql'
            ? { ...effectiveOptions(props.value), columnOrder: false, tableCollation: false }
            : props.value,
        )}
      >
        {
          Object.entries(effectiveOptions(props.value)).filter(
            ([key, selected]) =>
              selected &&
              (props.databaseType !== 'postgresql' ||
                !['columnOrder', 'tableCollation'].includes(key)),
          ).length
        }{' '}
        / {props.databaseType === 'postgresql' ? 5 : 7} 项 · 调整
      </Button>
    </Popover>
  );
}
