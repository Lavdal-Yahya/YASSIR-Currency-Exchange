// Map lookup that throws when the key is missing. Used by services that
// build a Map from the same query rows they later iterate — the `.get()`
// is provably safe, but eslint (rightly) bans bare non-null assertions.
// A thrown error is more useful than a silent `undefined` if the
// invariant is ever violated.
export function mustGet<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`${label}: missing key ${String(key)}`);
  }
  return value;
}
