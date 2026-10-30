import assert from "node:assert/strict";
import test from "node:test";
import { getLanUrls, getPrimaryLanUrl, isTailscaleAddress } from "../server/network-urls.js";

test("prefers a private LAN address and skips tunnel benchmark addresses", () => {
  const interfaces = {
    Mihomo: [{ family: "IPv4", address: "198.18.0.1", internal: false }],
    Ethernet: [{ family: "IPv4", address: "192.168.50.131", internal: false }]
  };

  assert.equal(getPrimaryLanUrl(9526, interfaces), "http://192.168.50.131:9526");
  assert.deepEqual(getLanUrls(9526, interfaces), ["http://192.168.50.131:9526"]);
});

test("orders private LAN addresses before other usable IPv4 addresses", () => {
  const interfaces = {
    Public: [{ family: "IPv4", address: "203.0.113.5", internal: false }],
    Private: [{ family: 4, address: "10.0.0.8", internal: false }]
  };

  assert.deepEqual(getLanUrls(8080, interfaces), [
    "http://10.0.0.8:8080",
    "http://203.0.113.5:8080"
  ]);
});

test("skips internal and link-local addresses and falls back to localhost", () => {
  const interfaces = {
    Loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    LinkLocal: [{ family: "IPv4", address: "169.254.10.20", internal: false }]
  };

  assert.deepEqual(getLanUrls(9526, interfaces), ["http://localhost:9526"]);
});

test("identifies Tailscale CGNAT IPv4 and IPv6 addresses", () => {
  assert.equal(isTailscaleAddress("100.64.0.1"), true);
  assert.equal(isTailscaleAddress("100.96.184.69"), true);
  assert.equal(isTailscaleAddress("100.127.255.254"), true);
  assert.equal(isTailscaleAddress("::ffff:100.96.184.69"), true);
  assert.equal(isTailscaleAddress("fd7a:115c:a1e0:ab12::1"), true);

  assert.equal(isTailscaleAddress("100.63.255.255"), false);
  assert.equal(isTailscaleAddress("100.128.0.1"), false);
  assert.equal(isTailscaleAddress("192.168.124.1"), false);
  assert.equal(isTailscaleAddress("127.0.0.1"), false);
  assert.equal(isTailscaleAddress(""), false);
  assert.equal(isTailscaleAddress(null), false);
});
