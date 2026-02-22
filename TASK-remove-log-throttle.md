# Task: Remove Marker Log Throttle

## Goal

Remove the 10% progress throttle from Marker extraction logging. Log every progress line instead.

## Why

For large PDFs (e.g., 719 pages), the 10% throttle causes ~70 seconds of silence between updates. This is a personal tool — seeing every page update is preferable to a "clean" log.

## Change

### `packages/server/src/lib/marker.ts`

Replace the throttled progress handler (lines ~162-182) with the simple version:

```ts
const rl = createInterface({ input: proc.stderr });
rl.on("line", (line) => {
  const progressMatch = line.match(/(\d+)\/(\d+)/);
  if (progressMatch) {
    const [, current, total] = progressMatch;
    const stage = line.trim().split(":")[0]?.trim() || "Processing";
    log(`${stage}: ${current}/${total}`);
  } else if (line.includes("WARNING") || line.includes("Error") || line.includes("Traceback")) {
    log(line.trim());
  }
});
```

Remove: `lastStage`, `lastLoggedPercent`, percentage calculation, `isNewStage`, `isSignificantProgress`, `isComplete` — none of it is needed.

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/lib/marker.ts` | Simplify stderr handler, remove throttle logic |

## Testing

1. Start extracting a multi-page PDF
2. Verify terminal and UI logs show every page increment (1/719, 2/719, 3/719, etc.)
3. Verify stage transitions (e.g., "Recognizing Layout" → "Detecting bboxes") still appear
4. Verify WARNING/Error lines still appear
