[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [utils/website-manager](../README.md) / WebsiteManager

# Class: WebsiteManager

Defined in: [utils/website-manager.ts:125](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L125)

DI-compatible WebsiteManager implementation.

## Implements

- `IWebsiteManager`

## Constructors

### Constructor

> **new WebsiteManager**(`logger`, `fileSystem`, `atomicOperations`): `WebsiteManager`

Defined in: [utils/website-manager.ts:128](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L128)

#### Parameters

##### logger

`ILogger`

##### fileSystem

`IFileSystem`

##### atomicOperations

`IAtomicOperations`

#### Returns

`WebsiteManager`

## Methods

### create()

> `static` **create**(`logger`, `fileSystem`, `atomicOperations`): `WebsiteManager`

Defined in: [utils/website-manager.ts:139](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L139)

Static factory method for DI container.

#### Parameters

##### logger

`ILogger`

##### fileSystem

`IFileSystem`

##### atomicOperations

`IAtomicOperations`

#### Returns

`WebsiteManager`

---

### createWebsite()

> **createWebsite**(`websiteName`): `Promise`\<`string`\>

Defined in: [utils/website-manager.ts:181](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L181)

Create a new website with the specified name and basic structure.

This function uses atomic operations to ensure data integrity:

- Creates website in temporary location first
- Validates all files are correctly generated
- Atomically moves to final location
- Automatic rollback on any failure.

#### Parameters

##### websiteName

`string`

Unique name for the new website (used as directory name).

#### Returns

`Promise`\<`string`\>

Promise resolving to the absolute path of the created website directory.

#### Throws

Error if a website with the same name already exists or creation fails.

#### Implementation of

`IWebsiteManager.createWebsite`

---

### validateWebsiteName()

> **validateWebsiteName**(`name`): `object`

Defined in: [utils/website-manager.ts:492](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L492)

Checks if a website name is valid according to naming rules and character restrictions.

#### Parameters

##### name

`string`

#### Returns

`object`

##### valid

> **valid**: `boolean`

##### error?

> `optional` **error**: `string`

#### Implementation of

`IWebsiteManager.validateWebsiteName`

---

### validateWebsiteNameAsync()

> **validateWebsiteNameAsync**(`name`): `Promise`\<\{ `valid`: `boolean`; `error?`: `string`; \}\>

Defined in: [utils/website-manager.ts:583](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L583)

Async version of validateWebsiteName that also checks for duplicates.
This should be used for website creation validation.

#### Parameters

##### name

`string`

#### Returns

`Promise`\<\{ `valid`: `boolean`; `error?`: `string`; \}\>

#### Implementation of

`IWebsiteManager.validateWebsiteNameAsync`

---

### listWebsites()

> **listWebsites**(): `Promise`\<`string`[]\>

Defined in: [utils/website-manager.ts:610](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L610)

List all existing websites.

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

`IWebsiteManager.listWebsites`

---

### deleteWebsite()

> **deleteWebsite**(`websiteName`, `parentWindow?`): `Promise`\<`boolean`\>

Defined in: [utils/website-manager.ts:645](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L645)

Delete a website with confirmation dialog.

#### Parameters

##### websiteName

`string`

##### parentWindow?

`BrowserWindow`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

`IWebsiteManager.deleteWebsite`

---

### getWebsitePath()

> **getWebsitePath**(`websiteName`): `string`

Defined in: [utils/website-manager.ts:688](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L688)

Constructs the full file system path for a website given its name.

#### Parameters

##### websiteName

`string`

#### Returns

`string`

#### Implementation of

`IWebsiteManager.getWebsitePath`

---

### renameWebsite()

> **renameWebsite**(`oldName`, `newName`): `Promise`\<`boolean`\>

Defined in: [utils/website-manager.ts:702](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L702)

Rename a website using atomic operations.

This function ensures data integrity during the rename operation:

- Validates new name before any changes
- Creates backup of target if it exists.
- Validates successful rename
- Automatic rollback on failure
- Updates internal references (package.json name).

#### Parameters

##### oldName

`string`

##### newName

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

`IWebsiteManager.renameWebsite`

---

### websiteExists()

> **websiteExists**(`websiteName`): `Promise`\<`boolean`\>

Defined in: [utils/website-manager.ts:852](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L852)

Check if a website exists.

#### Parameters

##### websiteName

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

`IWebsiteManager.websiteExists`

---

### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [utils/website-manager.ts:860](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/utils/website-manager.ts#L860)

Dispose of the website manager service.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`IWebsiteManager.dispose`
