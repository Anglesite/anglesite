[**@dwk Monorepo API Documentation v0.1.0**](../../README.md)

---

[@dwk Monorepo API Documentation](../../README.md) / [certificates](../README.md) / isCAInstalledInSystem

# Function: isCAInstalledInSystem()

> **isCAInstalledInSystem**(): `Promise`\<`boolean`\>

Defined in: [certificates.ts:132](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/certificates.ts#L132)

Check if Anglesite CA is installed and trusted in the system keychain

Uses the macOS security command to verify if the certificate is present
and trusted in the user keychain. This is the definitive test for SSL trust.

## Returns

`Promise`\<`boolean`\>

Promise resolving to true if CA is installed and trusted, false otherwise

## Example

```typescript
const isInstalled = await isCAInstalledInSystem();
if (!isInstalled) {
  await installCAInSystem();
}
```
