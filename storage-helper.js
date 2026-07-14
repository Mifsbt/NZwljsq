/*
 * storage-helper.js — 武器数据的持久化存储层
 * 优先使用 IndexedDB（容量大，适合存 base64 图片），不可用时降级到 localStorage（自动剥离图片）。
 * 两个页面（画布计算器 / 武器编辑器）共享同一数据库，数据自动互通。
 */
(function (global) {
  'use strict';

  const DB_NAME = 'nzw_db';
  const STORE_NAME = 'weapon_data';
  const REC_KEY = 'main';
  const LS_KEY = 'nzw_weapon_data';

  let _dbPromise = null;

  function hasIDB() {
    return (typeof global.indexedDB !== 'undefined') && !!global.indexedDB;
  }

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function idbSet(value) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, REC_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function idbGet() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(REC_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(tx.error);
    }));
  }

  function idbDel() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(REC_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  // 递归剥离图片字段（仅用于 localStorage 降级）
  function stripImages(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(stripImages);
    const copy = {};
    for (const k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        if (k === 'image') continue;
        copy[k] = stripImages(data[k]);
      }
    }
    return copy;
  }

  function lsSet(value) {
    try {
      global.localStorage.setItem(LS_KEY, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  // 保存武器数据：返回 Promise，resolve('idb'|'ls')
  function saveWeaponData(data) {
    if (hasIDB()) {
      return idbSet(data).then(() => 'idb').catch((err) => {
        console.warn('IndexedDB 保存失败，降级 localStorage', err);
        const str = JSON.stringify(stripImages(data));
        return lsSet(str) ? 'ls' : Promise.reject(err);
      });
    }
    const str = JSON.stringify(stripImages(data));
    return lsSet(str) ? Promise.resolve('ls') : Promise.reject(new Error('localStorage 写入失败'));
  }

  function migrateFromLS() {
    try {
      const saved = global.localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (hasIDB()) idbSet(parsed).catch(() => {}); // 旧数据迁移到 IndexedDB
          return parsed;
        }
      }
    } catch (e) {
      console.warn('读取 localStorage 旧数据失败', e);
    }
    return null;
  }

  // 读取武器数据：优先 IndexedDB；为空则尝试 localStorage 并迁移
  function loadWeaponData() {
    if (hasIDB()) {
      return idbGet()
        .then((val) => (val && typeof val === 'object' ? val : migrateFromLS()))
        .catch(() => migrateFromLS());
    }
    return Promise.resolve(migrateFromLS());
  }

  function clearWeaponData() {
    const p = hasIDB() ? idbDel().catch(() => {}) : Promise.resolve();
    return p.then(() => {
      try { global.localStorage.removeItem(LS_KEY); } catch (e) {}
    });
  }

  global.NZWStorage = {
    saveWeaponData,
    loadWeaponData,
    clearWeaponData,
    LS_KEY,
    DB_NAME,
    STORE_NAME,
    REC_KEY,
  };
})(window);
