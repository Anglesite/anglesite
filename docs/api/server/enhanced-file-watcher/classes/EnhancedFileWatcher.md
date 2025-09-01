[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [server/enhanced-file-watcher](../README.md) / EnhancedFileWatcher

# Class: EnhancedFileWatcher

Defined in: [server/enhanced-file-watcher.ts:65](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L65)

Enhanced file watcher class

## Constructors

### Constructor

> **new EnhancedFileWatcher**(`rebuildCallback`, `config`): `EnhancedFileWatcher`

Defined in: [server/enhanced-file-watcher.ts:74](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L74)

#### Parameters

##### rebuildCallback

[`RebuildCallback`](../type-aliases/RebuildCallback.md)

##### config

[`WatchModeConfig`](../interfaces/WatchModeConfig.md)

#### Returns

`EnhancedFileWatcher`

## Methods

### start()

> **start**(): `Promise`\<`void`\>

Defined in: [server/enhanced-file-watcher.ts:103](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L103)

Start watching files for changes.

#### Returns

`Promise`\<`void`\>

---

### stop()

> **stop**(): `Promise`\<`void`\>

Defined in: [server/enhanced-file-watcher.ts:143](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L143)

Stop watching files.

#### Returns

`Promise`\<`void`\>

---

### getMetrics()

> **getMetrics**(): [`WatchModeMetrics`](../interfaces/WatchModeMetrics.md)

Defined in: [server/enhanced-file-watcher.ts:167](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/server/enhanced-file-watcher.ts#L167)

Get current performance metrics.

#### Returns

[`WatchModeMetrics`](../interfaces/WatchModeMetrics.md)
