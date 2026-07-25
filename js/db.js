/**
 * db.js — طبقة التخزين المحلي (IndexedDB)
 * يخزن كل تسجيل صوتي مرتبطًا برقم صفحة المصحف (1-604)
 * لا يعتمد على أي اتصال بالإنترنت.
 */

const QuranDB = (() => {
  const DB_NAME = "quranReviewDB";
  const DB_VERSION = 1;
  const STORE = "recordings";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "page" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  async function saveRecording(page, blob, duration) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({
        page,
        blob,
        duration,
        mimeType: blob.type,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getRecording(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(page);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteRecording(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(page);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function hasRecording(page) {
    const rec = await getRecording(page);
    return !!rec;
  }

  async function getAllPageNumbers() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  return { saveRecording, getRecording, deleteRecording, hasRecording, getAllPageNumbers };
})();
