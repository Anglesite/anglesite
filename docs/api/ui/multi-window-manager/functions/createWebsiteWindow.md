[**@dwk Monorepo API Documentation v0.1.0**](../../../README.md)

---

[@dwk Monorepo API Documentation](../../../README.md) / [ui/multi-window-manager](../README.md) / createWebsiteWindow

# Function: createWebsiteWindow()

> **createWebsiteWindow**(`websiteName`, `websitePath?`): `BrowserWindow`

Defined in: [ui/multi-window-manager.ts:267](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/ui/multi-window-manager.ts#L267)

Create a new dedicated website window for editing and preview

Creates a singleton window for the specified website with its own WebContentsView
for live preview. Each website gets its own isolated window to enable concurrent
editing of multiple websites.

If a window already exists for the website and is not destroyed, it will be
focused instead of creating a new one.

## Parameters

### websiteName

`string`

Unique name of the website.

### websitePath?

`string`

Optional file system path to the website directory.

## Returns

`BrowserWindow`

The website window BrowserWindow instance.

## Example

```typescript
const websiteWin = createWebsiteWindow("my-blog", "/path/to/my-blog");
console.log(websiteWin.getTitle()); // 'my-blog'
```
