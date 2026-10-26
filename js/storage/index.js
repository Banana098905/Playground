/*
 * 保存バックエンドの選択。
 * IndexedDB → localStorage → メモリ の順に試す。
 * クラウド保存を追加するときは、ここで CloudRepo を優先して返すように拡張する。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});
  var S = (PZ.storage = PZ.storage || {});

  S.open = function () {
    var C = PZ.config;
    return S.IdbRepo.open(C.dbName, C.dbVersion).catch(function (err) {
      if (window.console) console.warn('[PZ] IndexedDB を使えません。代替保存を使います:', err && err.message);
      if (S.LocalStorageRepo.probe()) return new S.LocalStorageRepo();
      return new S.MemoryRepo();
    });
  };
})();
