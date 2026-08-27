// Safari 26 does not have Map.prototype.getOrInsertComputed yet, and pdf.js v6 calls it in the
// middle of rendering a page — every page arrived correctly sized, correctly cropped, and blank.
// Spec-shaped fill for the TC39 "upsert" pair; where the real methods exist it does nothing.
// Deliberately self-contained (no imports, no captures): PdfCanvas stringifies this function into
// the worker's bootstrap blob, because the worker bundle calls the method too.
export function installMapGetOrInsert(): void {
  for (const proto of [Map.prototype, WeakMap.prototype]) {
    const p = proto as unknown as Record<string, unknown>;
    if (typeof p.getOrInsert !== "function") {
      p.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      };
    }
    if (typeof p.getOrInsertComputed !== "function") {
      p.getOrInsertComputed = function (this: Map<unknown, unknown>, key: unknown, compute: (key: unknown) => unknown) {
        if (!this.has(key)) this.set(key, compute(key));
        return this.get(key);
      };
    }
  }
}

// Asked before installMapGetOrInsert runs, which is what makes the answer meaningful.
export function needsMapUpsertPolyfill(): boolean {
  return typeof (Map.prototype as unknown as Record<string, unknown>).getOrInsertComputed !== "function";
}
