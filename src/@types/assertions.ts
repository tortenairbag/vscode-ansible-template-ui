export function isObject<K extends string>(obj: unknown, keys: K[]): obj is Record<K, unknown> {
  return typeof obj === "object"
    && obj !== null /* eslint-disable-line no-null/no-null */
    && keys.every(key => key in obj);
}
