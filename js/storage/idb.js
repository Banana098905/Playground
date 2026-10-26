/*
 * 保存バックエンド①: IndexedDB（本命）
 *
 * リポジトリ共通インターフェース（Promise ベース）:
 *   kind                      バックエンド種別 'indexeddb' | 'localstorage' | 'memory'
 *   list()      -> record[]   すべての作品
 *   get(id)     -> record|null
 *   put(record) -> void
 *   remove(id)  -> void
 *   getMeta(key) / setMeta(key, value)
 *   persist()   -> boolean    ブラウザに「自動削除しない」ことを要求
 *
 * 将来クラウド保存に移行する場合は、同じインターフェースを実装した
 * リポジトリ（例: CloudRepo）を足し、storage/index.js で差し替えるだけでUIは変わりません。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var S = (PZ.storage = PZ.storage || {});

  function IdbRepo(db) {
    this.kind = 'indexeddb';
    this.db = db;
  }

  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction error')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  }
  function reqValue(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  IdbRepo.prototype._tx = function (store, mode) {
    try {
      // 書き込みはディスクへの反映を待つ（対応ブラウザのみ）
      return mode === 'readwrite'
        ? this.db.transaction(store, mode, { durability: 'strict' })
        : this.db.transaction(store, mode);
    } catch (e) {
      return this.db.transaction(store, mode);
    }
  };

  IdbRepo.prototype.list = function () {
    var tx = this._tx('projects', 'readonly');
    var req = tx.objectStore('projects').getAll();
    return reqValue(req);
  };
  IdbRepo.prototype.get = function (id) {
    var tx = this._tx('projects', 'readonly');
    return reqValue(tx.objectStore('projects').get(id)).then(function (r) { return r || null; });
  };
  IdbRepo.prototype.put = function (record) {
    var tx = this._tx('projects', 'readwrite');
    tx.objectStore('projects').put(record);
    return txDone(tx);
  };
  IdbRepo.prototype.remove = function (id) {
    var tx = this._tx('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    return txDone(tx);
  };
  IdbRepo.prototype.getMeta = function (key) {
    var tx = this._tx('meta', 'readonly');
    return reqValue(tx.objectStore('meta').get(key)).then(function (r) { return r ? r.value : null; });
  };
  IdbRepo.prototype.setMeta = function (key, value) {
    var tx = this._tx('meta', 'readwrite');
    tx.objectStore('meta').put({ key: key, value: value });
    return txDone(tx);
  };
  IdbRepo.prototype.persist = function () {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persisted().then(function (already) {
        return already ? true : navigator.storage.persist();
      }).catch(function () { return false; });
    }
    return Promise.resolve(false);
  };

  /** DBを開き、書き込み可能かを確認してから返す。失敗したら reject（呼び出し側がフォールバック） */
  IdbRepo.open = function (name, version) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
      var req;
      try { req = indexedDB.open(name, version); } catch (e) { reject(e); return; }
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('IndexedDB open timeout')); }
      }, 5000);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onerror = function () {
        if (settled) return; settled = true; clearTimeout(timer);
        reject(req.error || new Error('IndexedDB open error'));
      };
      req.onblocked = function () { /* 他タブが旧バージョンを開いている。タイムアウトまで待つ */ };
      req.onsuccess = function () {
        if (settled) { try { req.result.close(); } catch (e) { /* noop */ } return; }
        settled = true; clearTimeout(timer);
        var db = req.result;
        db.onversionchange = function () { db.close(); };
        var repo = new IdbRepo(db);
        // 書き込み確認（プライベートモード等では open に成功しても書けないことがある）
        repo.setMeta('__probe', Date.now()).then(function () { resolve(repo); }, reject);
      };
    });
  };

  S.IdbRepo = IdbRepo;
})();
