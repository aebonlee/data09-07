/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-07.db';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) {
      // 용량 초과(QuotaExceeded)도 여기로 옵니다 — 메모리에는 남겨 둡니다.
      ok = false; memory[k] = v; return false;
    }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  root.HNStore = {
    loadDb: function () {
      var raw = get(KEY_DB);
      if (!raw) return root.HNLogic.emptyDb();
      try { return root.HNLogic.normalizeDb(JSON.parse(raw)); } catch (e) { return root.HNLogic.emptyDb(); }
    },
    saveDb: function (db) { return set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
