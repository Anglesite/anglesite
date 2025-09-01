[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [server/enhanced-file-watcher](../README.md) / WatchModeMetrics

# Interface: WatchModeMetrics

Defined in: [server/enhanced-file-watcher.ts:47](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L47)

Performance metrics for watch mode

## Properties

### totalChanges

> **totalChanges**: `number`

Defined in: [server/enhanced-file-watcher.ts:49](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L49)

Total number of file changes detected

---

### totalRebuilds

> **totalRebuilds**: `number`

Defined in: [server/enhanced-file-watcher.ts:51](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L51)

Total number of rebuilds triggered

---

### averageRebuildTime

> **averageRebuildTime**: `number`

Defined in: [server/enhanced-file-watcher.ts:53](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L53)

Average rebuild time in milliseconds

---

### batchedChanges

> **batchedChanges**: `number`

Defined in: [server/enhanced-file-watcher.ts:55](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L55)

Number of batched changes

---

### ignoredChanges

> **ignoredChanges**: `number`

Defined in: [server/enhanced-file-watcher.ts:57](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L57)

Number of ignored changes

---

### peakMemoryUsage

> **peakMemoryUsage**: `number`

Defined in: [server/enhanced-file-watcher.ts:59](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L59)

Peak memory usage during watching

---

### startTime

> **startTime**: `number`

Defined in: [server/enhanced-file-watcher.ts:61](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L61)

Watch mode start time
