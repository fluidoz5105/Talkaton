"use strict";

const parameters = new URLSearchParams(location.search);
const failedUrl = parameters.get("url") || "";
const failedUrlLabel = document.querySelector("#failed-url");
const retryLink = document.querySelector("#retry");
const googleLink = document.querySelector("#google");

failedUrlLabel.textContent = failedUrl;
if (/^https?:\/\//i.test(failedUrl)) retryLink.href = failedUrl;
else retryLink.removeAttribute("href");

let query = failedUrl;
try { query = new URL(failedUrl).hostname; } catch {}
googleLink.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
