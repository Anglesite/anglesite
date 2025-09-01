[**@dwk Monorepo API Documentation v0.1.0**](../../README.md)

---

[@dwk Monorepo API Documentation](../../README.md) / [certificates](../README.md) / installCAInSystem

# Function: installCAInSystem()

> **installCAInSystem**(): `Promise`\<`boolean`\>

Defined in: [certificates.ts:152](https://github.com/Anglesite/anglesite/blob/97bc711271b9559b54e48a9e5995ecc7ba9204f9/anglesite/app/certificates.ts#L152)

Install Anglesite CA into user keychain as a trusted root certificate.
This enables SSL certificates signed by the Anglesite CA to be trusted by browsers.
Installs in user keychain to avoid requiring administrator privileges.

## Returns

`Promise`\<`boolean`\>

Promise resolving to true if installation succeeded, false if failed.
