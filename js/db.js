/**
 * db.js — طبقة التخزين المحلي (IndexedDB)
 * يخزن نوعين من التسجيلات:
 *  - "recordings"      تسجيل لكل صفحة من صفحات المصحف (1-604)
 *  - "surahRecordings" تسجيل واحد متصل لكل سورة كاملة (1-114)
 * لا يعتمد على أي اتصال بالإنترنت — كل شيء محفوظ على الجهاز فقط.
 */

const QuranDB = (() => {
  const DB_NAME = "quranReviewDB";
  const DB_VERSION = 2;
  const STORE = "recordings";
  const SURAH_STORE = "surahRecordings";

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
        if (!db.objectStoreNames.contains(SURAH_STORE)) {
          db.createObjectStore(SURAH_STORE, { keyPath: "surah" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  // ===== تسجيلات الصفحات =====
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

  // ===== تسجيلات السور الكاملة =====
  async function saveSurahRecording(surah, blob, duration) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SURAH_STORE, "readwrite");
      tx.objectStore(SURAH_STORE).put({
        surah,
        blob,
        duration,
        mimeType: blob.type,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getSurahRecording(surah) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SURAH_STORE, "readonly");
      const req = tx.objectStore(SURAH_STORE).get(surah);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteSurahRecording(surah) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SURAH_STORE, "readwrite");
      tx.objectStore(SURAH_STORE).delete(surah);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function hasSurahRecording(surah) {
    const rec = await getSurahRecording(surah);
    return !!rec;
  }

  async function getAllSurahNumbers() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SURAH_STORE, "readonly");
      const req = tx.objectStore(SURAH_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  return {
    saveRecording, getRecording, deleteRecording, hasRecording, getAllPageNumbers,
    saveSurahRecording, getSurahRecording, deleteSurahRecording, hasSurahRecording, getAllSurahNumbers,
  };
})();
