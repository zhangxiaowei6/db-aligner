/** Models crossing the local protocol contain JSON values only. Vue proxies must
 * be serialized before cloning an editable draft. */
export function copyModel<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
