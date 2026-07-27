import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress, assertPublicURL, type HostLookup } from "./net-guard";

/** No test in this file touches DNS or the network — the resolver is always injected. */
const resolvesTo = (...addresses: string[]): HostLookup => async () => addresses;
const neverResolves: HostLookup = async () => {
  throw new Error("ENOTFOUND");
};

test("isBlockedAddress: loopback, private, link-local and metadata addresses are refused", () => {
  for (const address of [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // the cloud metadata endpoint this guard mainly exists for
    "100.64.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",
  ]) {
    assert.ok(isBlockedAddress(address), address);
  }
});

test("isBlockedAddress: ordinary public addresses are allowed", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "104.244.42.1", "172.32.0.1", "192.169.0.1", "100.128.0.1"]) {
    assert.ok(!isBlockedAddress(address), address);
  }
});

test("isBlockedAddress: IPv6 loopback, unique-local, link-local and multicast are refused", () => {
  for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
    assert.ok(isBlockedAddress(address), address);
  }
});

test("isBlockedAddress: public IPv6 is allowed", () => {
  for (const address of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.ok(!isBlockedAddress(address), address);
  }
});

test("isBlockedAddress: an IPv4-mapped IPv6 address is judged on its embedded v4", () => {
  assert.ok(isBlockedAddress("::ffff:127.0.0.1"));
  assert.ok(isBlockedAddress("::ffff:169.254.169.254"));
  assert.ok(!isBlockedAddress("::ffff:8.8.8.8"));
});

test("isBlockedAddress: anything not classifiable as a public IP is refused", () => {
  for (const value of ["", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5"]) {
    assert.ok(isBlockedAddress(value), value);
  }
});

test("assertPublicURL: a private IP literal in the URL is refused without any lookup", async () => {
  const shouldNotRun: HostLookup = async () => {
    throw new Error("lookup must not be called for an IP literal");
  };
  await assert.rejects(
    () => assertPublicURL("http://169.254.169.254/latest/meta-data/", shouldNotRun),
    /private or reserved address/,
  );
  await assert.rejects(() => assertPublicURL("http://127.0.0.1:9200/", shouldNotRun), /private or reserved/);
  await assert.rejects(() => assertPublicURL("http://[::1]:8080/x", shouldNotRun), /private or reserved/);
});

test("assertPublicURL: a public IP literal passes", async () => {
  await assertPublicURL("https://1.1.1.1/", neverResolves);
});

test("assertPublicURL: a hostname resolving to a private address is refused", async () => {
  // The `localtest.me` class of hostname: perfectly ordinary DNS, points at 127.0.0.1.
  await assert.rejects(
    () => assertPublicURL("https://internal.example.com/x", resolvesTo("10.0.0.5")),
    /resolves to a private or reserved address \(10\.0\.0\.5\)/,
  );
});

test("assertPublicURL: one private answer among several is enough to refuse", async () => {
  await assert.rejects(
    () => assertPublicURL("https://mixed.example.com/", resolvesTo("93.184.216.34", "127.0.0.1")),
    /resolves to a private or reserved/,
  );
});

test("assertPublicURL: a hostname resolving only to public addresses passes", async () => {
  await assertPublicURL("https://example.com/post", resolvesTo("93.184.216.34", "2606:2800:220:1::1"));
});

test("assertPublicURL: an unresolvable host is refused rather than passed through", async () => {
  await assert.rejects(() => assertPublicURL("https://nope.invalid/", neverResolves), /did not resolve/);
  await assert.rejects(() => assertPublicURL("https://empty.example/", resolvesTo()), /did not resolve/);
});

test("assertPublicURL: a malformed URL is refused", async () => {
  await assert.rejects(() => assertPublicURL("not a url", neverResolves), /malformed URL/);
});
