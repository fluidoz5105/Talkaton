"use strict";

const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=";

function looksLikeHost(value) {
  return (
    /^localhost(?::\d+)?(?:[/?#].*)?$/i.test(value)
    || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(value)
    || /^(?:[^\s.]+\.)+[^\s.]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)
  );
}

function toNavigableUrl(rawValue, searchUrl = DEFAULT_SEARCH_URL) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href;
    } catch {
      return null;
    }
  }

  if (looksLikeHost(value)) {
    const local = /^localhost(?::|\/|$)/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}/.test(value);
    try {
      return new URL(`${local ? "http" : "https"}://${value}`).href;
    } catch {
      return null;
    }
  }

  // Explicit non-web schemes should never be converted into a search. This is
  // intentionally checked after host detection so localhost:3000 still works.
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  return `${searchUrl}${encodeURIComponent(value)}`;
}

function isWebUrl(rawValue) {
  try {
    const { protocol } = new URL(rawValue);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isExternalUrl(rawValue) {
  try {
    const { protocol } = new URL(rawValue);
    return protocol === "mailto:" || protocol === "tel:";
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_SEARCH_URL,
  isExternalUrl,
  isWebUrl,
  looksLikeHost,
  toNavigableUrl
};
