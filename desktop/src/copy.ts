/** Models crossing the local protocol contain JSON values only.
 * Clone editable drafts so nested edits cannot change the saved model. */
export function copyModel<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
