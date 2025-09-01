[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [server/enhanced-file-watcher](../README.md) / WatchModeConfig

# Interface: WatchModeConfig

Defined in: [server/enhanced-file-watcher.ts:29](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L29)

Watch mode configuration

## Properties

### inputDir

> **inputDir**: `string`

Defined in: [server/enhanced-file-watcher.ts:31](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L31)

Base directory to watch

---

### outputDir

> **outputDir**: `string`

Defined in: [server/enhanced-file-watcher.ts:33](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L33)

Build output directory to exclude from watching

---

### debounceMs?

> `optional` **debounceMs**: `number`

Defined in: [server/enhanced-file-watcher.ts:35](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L35)

Debounce delay in milliseconds (default: 300ms)

---

### maxBatchSize?

> `optional` **maxBatchSize**: `number`

Defined in: [server/enhanced-file-watcher.ts:37](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L37)

Maximum batch size for changes (default: 50)

---

### enableMetrics?

> `optional` **enableMetrics**: `boolean`

Defined in: [server/enhanced-file-watcher.ts:39](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L39)

Enable performance monitoring (default: true)

---

### ignorePatterns?

> `optional` **ignorePatterns**: `string`[]

Defined in: [server/enhanced-file-watcher.ts:41](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L41)

Additional patterns to ignore

---

### priorityExtensions?

> `optional` **priorityExtensions**: `string`[]

Defined in: [server/enhanced-file-watcher.ts:43](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L43)

File extensions to prioritize for faster rebuilds
