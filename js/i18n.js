/**
 * BoardHack i18n — loads ONLY the selected language JSON from /locales.
 * Usage:
 *   BoardHackI18n.init({ page: "chess/classic", base: "../../../locales" })
 *     .then(function () { ... use BoardHackI18n.t("key") ... });
 * Edit strings in locales/ru.json and locales/en.json (shared + pages[pageId]).
 */
(function (global) {
  "use strict";

  var LANG_KEY = "boardhack-lang";
  var VERSION = "20261003a";
  var SUPPORTED = { ru: true, en: true };

  var lang = readSavedLang();
  var pageId = "hub";
  var basePath = "locales";
  var strings = Object.create(null);
  var loadPromise = null;

  function readSavedLang() {
    try {
      var saved = global.localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "ru") return saved;
    } catch (e) {}
    return "ru";
  }

  function localeUrl(code) {
    var base = String(basePath || "locales").replace(/\/$/, "");
    return base + "/" + code + ".json?v=" + VERSION;
  }

  function mergePack(pack) {
    var out = Object.create(null);
    var shared = (pack && pack.shared) || {};
    var pages = (pack && pack.pages) || {};
    var pagePack = pages[pageId] || {};
    var k;
    for (k in shared) {
      if (Object.prototype.hasOwnProperty.call(shared, k)) out[k] = shared[k];
    }
    for (k in pagePack) {
      if (Object.prototype.hasOwnProperty.call(pagePack, k)) out[k] = pagePack[k];
    }
    return out;
  }

  function fetchLocale(code) {
    return fetch(localeUrl(code), { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("Failed to load locale: " + code + " (" + res.status + ")");
      return res.json();
    }).then(function (pack) {
      strings = mergePack(pack);
      lang = code;
      return lang;
    });
  }

  function init(opts) {
    opts = opts || {};
    if (opts.page) pageId = opts.page;
    if (opts.base) basePath = opts.base;
    if (opts.version) VERSION = String(opts.version);
    var code = lang;
    if (opts.lang === "en" || opts.lang === "ru") code = opts.lang;
    loadPromise = fetchLocale(code).catch(function (err) {
      console.error("[BoardHackI18n]", err);
      strings = Object.create(null);
      return lang;
    });
    return loadPromise;
  }

  function t(key) {
    if (key == null) return "";
    if (Object.prototype.hasOwnProperty.call(strings, key) && strings[key] != null) {
      return strings[key];
    }
    return String(key);
  }

  function setLang(next) {
    if (!SUPPORTED[next]) return Promise.resolve(lang);
    try {
      global.localStorage.setItem(LANG_KEY, next);
    } catch (e) {}
    if (next === lang && Object.keys(strings).length) {
      return Promise.resolve(lang);
    }
    loadPromise = fetchLocale(next).catch(function (err) {
      console.error("[BoardHackI18n]", err);
      return lang;
    });
    return loadPromise;
  }

  function getLang() {
    return lang;
  }

  function ready() {
    return loadPromise || Promise.resolve(lang);
  }

  global.BoardHackI18n = {
    LANG_KEY: LANG_KEY,
    VERSION: VERSION,
    init: init,
    ready: ready,
    t: t,
    setLang: setLang,
    getLang: getLang,
    getPage: function () { return pageId; }
  };
})(typeof window !== "undefined" ? window : this);
