/*
 * 保存バックエンド②③: IndexedDB が使えない環境向けの代替
 *   LocalStorageRepo … 容量は小さいが再読み込み後も残る
 *   MemoryRepo       … タブを閉じると消える（最後の手段。UIで警告を表示する）
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var S = (PZ.storage = PZ.storage || {});

  /* ---------- localStorage ---------- */
  var KEY_P = 'pz:projects';
  var KEY_M = 'pz:meta';

  function LocalStorageRepo() { this.kind = 'localstorage'; }
  LocalStorageRepo.prototype._read = function (key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
  };
  LocalStorageRepo.prototype._write = function (key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return Promise.resolve(); }
    catch (e) { return Promise.reject(e); }
  };
  LocalStorageRepo.prototype.list = function () {
    var m = this._read(KEY_P);
    return Promise.resolve(Object.keys(m).map(function (k) { return m[k]; }));
  };
  LocalStorageRepo.prototype.get = function (id) {
    return Promise.resolve(this._read(KEY_P)[id] || null);
  };
  LocalStorageRepo.prototype.put = function (record) {
    var m = this._read(KEY_P);
    m[record.id] = record;
    return this._write(KEY_P, m);
  };
  LocalStorageRepo.prototype.remove = function (id) {
    var m = this._read(KEY_P);
    delete m[id];
    return this._write(KEY_P, m);
  };
  LocalStorageRepo.prototype.getMeta = function (key) {
    var v = this._read(KEY_M)[key];
    return Promise.resolve(v === undefined ? null : v);
  };
  LocalStorageRepo.prototype.setMeta = function (key, value) {
    var m = this._read(KEY_M);
    m[key] = value;
    return this._write(KEY_M, m);
  };
  LocalStorageRepo.prototype.persist = function () { return Promise.resolve(false); };
  LocalStorageRepo.probe = function () {
    try {
      localStorage.setItem('pz:probe', '1');
      localStorage.removeItem('pz:probe');
      return true;
    } catch (e) { return false; }
  };

  /* ---------- メモリ ---------- */
  function MemoryRepo() {
    this.kind = 'memory';
    this._p = {};
    this._m = {};
  }
  MemoryRepo.prototype.list = function () {
    var self = this;
    return Promise.resolve(Object.keys(this._p).map(function (k) { return self._p[k]; }));
  };
  MemoryRepo.prototype.get = function (id) { return Promise.resolve(this._p[id] || null); };
  MemoryRepo.prototype.put = function (record) {
    this._p[record.id] = JSON.parse(JSON.stringify(record));
    return Promise.resolve();
  };
  MemoryRepo.prototype.remove = function (id) { delete this._p[id]; return Promise.resolve(); };
  MemoryRepo.prototype.getMeta = function (key) {
    return Promise.resolve(this._m[key] === undefined ? null : this._m[key]);
  };
  MemoryRepo.prototype.setMeta = function (key, value) { this._m[key] = value; return Promise.resolve(); };
  MemoryRepo.prototype.persist = function () { return Promise.resolve(false); };

  S.LocalStorageRepo = LocalStorageRepo;
  S.MemoryRepo = MemoryRepo;
})();
