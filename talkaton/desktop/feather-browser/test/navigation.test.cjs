"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isExternalUrl, isWebUrl, looksLikeHost, toNavigableUrl } = require("../shared.cjs");

test("keeps valid HTTP and HTTPS URLs", () => {
  assert.equal(toNavigableUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(toNavigableUrl("http://example.com"), "http://example.com/");
});

test("promotes domains to HTTPS", () => {
  assert.equal(toNavigableUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(looksLikeHost("sub.example.co.uk"), true);
});

test("uses HTTP for local development hosts", () => {
  assert.equal(toNavigableUrl("localhost:5173/app"), "http://localhost:5173/app");
  assert.equal(toNavigableUrl("127.0.0.1:3000"), "http://127.0.0.1:3000/");
});

test("turns plain text into a Google search", () => {
  assert.equal(toNavigableUrl("lightweight chromium browser"), "https://www.google.com/search?q=lightweight%20chromium%20browser");
});

test("rejects active and privileged schemes", () => {
  assert.equal(toNavigableUrl("javascript:alert(1)"), null);
  assert.equal(toNavigableUrl("file:///etc/passwd"), null);
  assert.equal(toNavigableUrl("data:text/html,hello"), null);
});

test("classifies web and external URLs", () => {
  assert.equal(isWebUrl("https://example.com"), true);
  assert.equal(isWebUrl("mailto:a@example.com"), false);
  assert.equal(isExternalUrl("mailto:a@example.com"), true);
  assert.equal(isExternalUrl("tel:+15551234567"), true);
});
