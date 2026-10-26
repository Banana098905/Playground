/*
 * PLAYGROUND ZERO — 設定
 * 公開時に変えたくなる値はここにまとめています。
 */
(function () {
  'use strict';
  var PZ = (window.PZ = window.PZ || {});

  PZ.config = {
    name: 'PLAYGROUND ZERO',
    short: 'PG/0',
    tagline: '作る。壊す。発見する。また作る。',
    version: '2.0.0',
    phase: 'PHASE 2',

    // 保存先データベース名。独自ドメインへ移行しても同じオリジンなら引き継がれます。
    dbName: 'playground-zero',
    dbVersion: 1,

    // 既存ポートフォリオなど、外部サイトへ戻るリンク（任意）。
    // 空文字なら表示されません。例: 'https://example.com/portfolio/'
    portfolioUrl: '',
    portfolioLabel: 'ポートフォリオへ戻る',

    // Studio の既定キャンバス
    canvas: { width: 960, height: 600, background: '#1d2127' },

    // 作品数・オブジェクト数の安全上限
    limits: { objects: 1000, projectNameLength: 80, undoSteps: 100, tags: 10, tagLength: 24, collections: 50, collectionNameLength: 40, paramsBytes: 20000, thumbBytes: 90000, importItems: 1000, importBytes: 50 * 1024 * 1024 },

    // バックアップファイルの形式バージョン（読み込めるのは supportedBackupFormats のみ）
    backupFormat: 2,
    supportedBackupFormats: [1, 2],

    // 自動保存の待ち時間(ms)
    autosaveDelay: 700,

    // バックアップ推奨の間隔(日)
    backupReminderDays: 7
  };
})();
