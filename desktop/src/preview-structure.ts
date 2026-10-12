import type { Change, Column, Table, TableChoice } from './types';
import { effectiveOptions, fullStructure } from './structure-options';

// Synthetic preview fixtures only. Real SQL generation belongs to the Java engine.
function commentDefinition(definition: string, comment: string) {
  let quote = '',
    start = -1,
    end = -1,
    depth = 0;
  for (let i = 0; i < definition.length; i++) {
    const char = definition[i];
    if (quote) {
      if (char === '\\' && quote !== '`') {
        i++;
        continue;
      }
      if (char === quote) {
        if (definition[i + 1] === quote) i++;
        else quote = '';
      }
      continue;
    }
    if (["'", '"', '`'].includes(char)) {
      quote = char;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (!depth && /^COMMENT\s/i.test(definition.slice(i)) && /\s/.test(definition[i - 1] || ' ')) {
      start = i;
      let j = i + 7;
      while (/\s/.test(definition[j] || '') && j < definition.length) j++;
      const literal = definition[j++];
      while (j < definition.length) {
        const ch = definition[j++];
        if (ch === '\\') {
          j++;
          continue;
        }
        if (ch === literal) {
          if (definition[j] === literal) j++;
          else {
            end = j;
            break;
          }
        }
      }
      break;
    }
  }
  const base =
    start >= 0 && end >= 0 ? definition.slice(0, start) + definition.slice(end) : definition;
  return (
    base.trim() +
    (comment ? ` COMMENT '${comment.replaceAll('\\', '\\\\').replaceAll("'", "''")}'` : '')
  );
}
export function previewStructureChange(
  change: Change,
  choice: TableChoice,
  source: Table,
  target: Table,
  database: string,
): Change | undefined {
  if (change.kind.endsWith('_ROW')) return choice.data ? change : undefined;
  if (!choice.structure) return undefined;
  const options = effectiveOptions(choice.structureOptions);
  if (!target.exists && !fullStructure(options)) return undefined;
  const kind = change.kind;
  if (kind === 'CREATE_TABLE' && target.exists) return undefined;
  if (kind === 'TABLE_COMMENT' && source.comment === target.comment) return undefined;
  if (kind === 'ADD_INDEX' && target.indexes.some((index) => index.name === change.label))
    return undefined;
  if (
    kind === 'DROP_COLUMN' &&
    (!target.columns.some((column) => column.name === change.label) ||
      source.columns.some((column) => column.name === change.label))
  )
    return undefined;
  if (
    (kind === 'TABLE_COMMENT' && !options.tableComment) ||
    (kind === 'TABLE_COLLATION' && !options.tableCollation) ||
    (kind.includes('INDEX') && !options.indexes) ||
    (kind.endsWith('_FK') && !options.foreignKeys) ||
    (['ADD_COLUMN', 'DROP_COLUMN'].includes(kind) && !options.columns)
  )
    return undefined;
  if (!['MODIFY_COLUMN', 'ADD_COLUMN'].includes(kind)) return change;
  const column = source.columns.find((item) => item.name === change.label);
  const old = target.columns.find((item) => item.name === change.label);
  if (!column || (kind === 'ADD_COLUMN' && old)) return undefined;
  const base = kind === 'ADD_COLUMN' || options.columns ? column : old;
  if (!base) return undefined;
  const parts: string[] = [];
  if (kind === 'MODIFY_COLUMN' && old) {
    const signature = (c: Column) =>
      JSON.stringify([c.type, c.nullable, c.defaultValue, c.extra, c.generation, c.collation]);
    if (options.columns && signature(column) !== signature(old)) parts.push('columns');
    if (options.columnOrder && column.ordinal !== old.ordinal) parts.push('columnOrder');
    if (options.columnComments && column.comment !== old.comment) parts.push('columnComments');
    if (!parts.length) return undefined;
  }
  const comment = options.columnComments ? column.comment : old?.comment || '';
  const effective = {
    ...base,
    comment,
    ordinal: options.columnOrder ? column.ordinal : old?.ordinal || target.columns.length + 1,
    definition: commentDefinition(base.definition, comment),
  };
  const moving = kind === 'ADD_COLUMN' ? options.columnOrder : parts.includes('columnOrder');
  const previous = source.columns[column.ordinal - 2]?.name;
  const position = moving ? (previous ? ` AFTER \`${previous}\`` : ' FIRST') : '';
  return {
    ...change,
    changedParts: kind === 'MODIFY_COLUMN' ? parts : undefined,
    risk: kind === 'MODIFY_COLUMN' && parts.some((part) => part !== 'columnComments'),
    selected: kind === 'ADD_COLUMN' || parts.every((part) => part === 'columnComments'),
    sql: `ALTER TABLE \`${database}\`.\`${source.name}\` ${kind === 'ADD_COLUMN' ? 'ADD' : 'MODIFY'} COLUMN ${effective.definition}${position};`,
    before: { column: old },
    after: { column: effective, ...(moving ? (previous ? { previous } : { first: true }) : {}) },
    rollbackSql: old
      ? [`ALTER TABLE \`${database}\`.\`${source.name}\` MODIFY COLUMN ${old.definition};`]
      : change.rollbackSql,
  };
}
