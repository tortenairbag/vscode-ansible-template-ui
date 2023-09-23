import * as yaml from "yaml";

export function isObject<K extends string>(obj: unknown, keys: K[]): obj is Record<K, unknown> {
  return typeof obj === "object"
    && !Array.isArray(obj)
    && obj !== null /* eslint-disable-line no-null/no-null */
    && keys.every(key => key in obj);
}

export function isStringArray(arr: unknown): arr is string[] {
  return Array.isArray(arr)
    && arr.every(host => typeof host === "string");
}

export function parseVariableString(str: string) {
  let variablesParsed: unknown;
  /* JSON */
  try {
    variablesParsed = JSON.parse(str) as unknown;
  } catch { /* swallow */ }
  if (isObject(variablesParsed, [])) {
    return { result: variablesParsed, language: "json" };
  }
  /* YAML */
  try {
    variablesParsed = yaml.parse(str) as unknown;
  } catch { /* swallow */ }
  if (isObject(variablesParsed, [])) {
    return { result: variablesParsed, language: "yaml" };
  }
  return undefined;
}
