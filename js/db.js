/**
 * db.js — طبقة التخزين المحلي (IndexedDB)
 * يخزن:
 *  - "recordings"       تسجيل لكل صفحة من صفحات المصحف (1-604)
 *  - "surahRecordings"  تسجيل واحد متصل لكل سورة كاملة (1-114)
 *  - "hizbRecordings"   تسجيل واحد متصل لكل حزب كامل (1-60)
 *  - "testRecordings"   تسجيلات إجابات اختبار الحفظ (لكل سؤال داخل كل حزب)
 *  - "usedQuestions"    تتبع الأسئلة المستخدمة سابقًا في كل حزب (لعدم التكرار)
 *  - "recordingHistory" أرشيف كل نسخ التسجيل السابقة لكل صفحة/سورة/حزب (سجل التقدّم)
 * لا يعتمد على أي اتصال بالإنترنت — كل شيء محفوظ على الجهاز فقط.
 */

const QuranDB = (() => {
  const DB_NAME = "quranReviewDB";
  const DB_VERSION = 6;
  const STORE = "recordings";
  const SURAH_STORE = "surahRecordings";
  const HIZB_STORE = "hizbRecordings";
  const TEST_STORE = "testRecordings";
  const USED_Q_STORE = "usedQuestions";
  const HISTORY_STORE = "recordingHistory";
  const ERROR_MARKS_STORE = "errorMarks";

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
        if (!db.objectStoreNames.contains(HIZB_STORE)) {
          db.createObjectStore(HIZB_STORE, { keyPath: "hizb" });
        }
        if (!db.objectStoreNames.contains(TEST_STORE)) {
          const ts = db.createObjectStore(TEST_STORE, { keyPath: "id" });
          ts.createIndex("byHizbAttempt", ["hizb", "attemptId"], { unique: false });
        }
        if (!db.objectStoreNames.contains(USED_Q_STORE)) {
          db.createObjectStore(USED_Q_STORE, { keyPath: "hizb" });
        }
        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          const hs = db.createObjectStore(HISTORY_STORE, { keyPath: "id" });
          hs.createIndex("byTypeTarget", ["type", "targetId"], { unique: false });
        }
        if (!db.objectStoreNames.contains(ERROR_MARKS_STORE)) {
          db.createObjectStore(ERROR_MARKS_STORE, { keyPath: "page" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
      // يحدث هذا عادةً إن كان التطبيق مفتوحًا في تبويب آخر بنسخة أقدم — بدون هذا
      // المعالج يظل الطلب معلَّقًا للأبد دون resolve أو reject، فتتجمّد كل أزرار
      // التطبيق (قائمة الاستماع والاختبار وغيرهما) بصمت دون أي خطأ ظاهر.
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error("التطبيق مفتوح في تبويب آخر — أغلق التبويبات الأخرى لهذا التطبيق ثم أعد المحاولة"));
      };
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = (e) => reject(e.target.error);
    });
  }

  // ===== تسجيلات الصفحات =====
  async function saveRecording(page, blob, duration) {
    const db = await open();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ page, blob, duration, mimeType: blob.type, createdAt: Date.now() });
    return txDone(tx);
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
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(page);
    return txDone(tx);
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
    const tx = db.transaction(SURAH_STORE, "readwrite");
    tx.objectStore(SURAH_STORE).put({ surah, blob, duration, mimeType: blob.type, createdAt: Date.now() });
    return txDone(tx);
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
    const tx = db.transaction(SURAH_STORE, "readwrite");
    tx.objectStore(SURAH_STORE).delete(surah);
    return txDone(tx);
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

  // ===== تسجيلات الأحزاب الكاملة (جديد) =====
  async function saveHizbRecording(hizb, blob, duration, meta) {
    const db = await open();
    const tx = db.transaction(HIZB_STORE, "readwrite");
    tx.objectStore(HIZB_STORE).put({
      hizb, blob, duration, mimeType: blob.type, createdAt: Date.now(),
      hizbName: meta && meta.hizbName,
      startSurahName: meta && meta.startSurahName,
      endSurahName: meta && meta.endSurahName,
      startPage: meta && meta.startPage,
      endPage: meta && meta.endPage,
    });
    return txDone(tx);
  }

  async function getHizbRecording(hizb) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HIZB_STORE, "readonly");
      const req = tx.objectStore(HIZB_STORE).get(hizb);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteHizbRecording(hizb) {
    const db = await open();
    const tx = db.transaction(HIZB_STORE, "readwrite");
    tx.objectStore(HIZB_STORE).delete(hizb);
    return txDone(tx);
  }

  async function hasHizbRecording(hizb) {
    const rec = await getHizbRecording(hizb);
    return !!rec;
  }

  async function getAllHizbNumbers() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HIZB_STORE, "readonly");
      const req = tx.objectStore(HIZB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ===== تسجيلات اختبار الحفظ (جديد) =====
  // كل تسجيل سؤال يُحفظ بمعرّف فريد: hizb + attemptId + qid
  async function saveTestRecording({ hizb, attemptId, qid, questionNumber, page, surah, surahName, ayah, prefix, blob, duration, type, fromPage, toPage, nextSurahName }) {
    const db = await open();
    const id = `${hizb}_${attemptId}_${qid}`;
    const tx = db.transaction(TEST_STORE, "readwrite");
    tx.objectStore(TEST_STORE).put({
      id, hizb, attemptId, qid, questionNumber, page, surah, surahName, ayah, prefix,
      type: type || "random", fromPage: fromPage || null, toPage: toPage || null, nextSurahName: nextSurahName || null,
      blob, duration, mimeType: blob.type, createdAt: Date.now(),
    });
    return txDone(tx);
  }

  async function getTestRecordingsForAttempt(hizb, attemptId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_STORE, "readonly");
      const idx = tx.objectStore(TEST_STORE).index("byHizbAttempt");
      const range = IDBKeyRange.only([hizb, attemptId]);
      const req = idx.getAll(range);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.questionNumber - b.questionNumber));
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllTestRecordingsForHizb(hizb) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TEST_STORE, "readonly");
      const store = tx.objectStore(TEST_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []).filter((r) => r.hizb === hizb));
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteTestRecording(id) {
    const db = await open();
    const tx = db.transaction(TEST_STORE, "readwrite");
    tx.objectStore(TEST_STORE).delete(id);
    return txDone(tx);
  }

  async function deleteAttempt(hizb, attemptId) {
    const recs = await getTestRecordingsForAttempt(hizb, attemptId);
    const db = await open();
    const tx = db.transaction(TEST_STORE, "readwrite");
    const store = tx.objectStore(TEST_STORE);
    recs.forEach((r) => store.delete(r.id));
    return txDone(tx);
  }

  // ===== تتبع الأسئلة المستخدمة لكل حزب (لعدم تكرار نفس المقاطع) =====
  async function getUsedQuestionIds(hizb) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(USED_Q_STORE, "readonly");
      const req = tx.objectStore(USED_Q_STORE).get(hizb);
      req.onsuccess = () => resolve((req.result && req.result.usedIds) || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function addUsedQuestionIds(hizb, qids) {
    const existing = await getUsedQuestionIds(hizb);
    const merged = Array.from(new Set([...existing, ...qids]));
    const db = await open();
    const tx = db.transaction(USED_Q_STORE, "readwrite");
    tx.objectStore(USED_Q_STORE).put({ hizb, usedIds: merged, updatedAt: Date.now() });
    return txDone(tx);
  }

  async function resetUsedQuestionIds(hizb) {
    const db = await open();
    const tx = db.transaction(USED_Q_STORE, "readwrite");
    tx.objectStore(USED_Q_STORE).put({ hizb, usedIds: [], updatedAt: Date.now() });
    return txDone(tx);
  }

  // ===== علامات مواضع الأخطاء على صورة الصفحة =====
  // كل صفحة تُخزَّن بسجل واحد يضم كل دوائرها، بإحداثيات نسبية (% من عرض/ارتفاع
  // الصورة) لتبقى في مكانها الصحيح مهما تغيّر حجم الشاشة. يبقى سجل الصفحة
  // موجودًا حتى بعد حذف كل علاماتها (بمصفوفة فارغة) ليظهر "0" في الإحصائيات
  // كدليل تحسّن، بدل اختفاء الصفحة من القائمة كليًا.
  async function getErrorMarks(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ERROR_MARKS_STORE, "readonly");
      const req = tx.objectStore(ERROR_MARKS_STORE).get(page);
      req.onsuccess = () => resolve((req.result && req.result.marks) || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function saveErrorMarks(page, marks) {
    const db = await open();
    const tx = db.transaction(ERROR_MARKS_STORE, "readwrite");
    tx.objectStore(ERROR_MARKS_STORE).put({ page, marks, updatedAt: Date.now() });
    return txDone(tx);
  }

  async function getAllErrorMarkPages() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ERROR_MARKS_STORE, "readonly");
      const req = tx.objectStore(ERROR_MARKS_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.page - b.page));
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ملاذ أخير للتعافي: يحذف قاعدة البيانات المحلية بالكامل (كل التسجيلات) ليُعاد
  // إنشاؤها من جديد بأحدث بنية. تُستخدم فقط إن تعذّر الإصلاح التلقائي عبر ترقية
  // الإصدار العادية (مثلاً إن كانت قاعدة البيانات في حالة غير متّسقة لسبب ما).
  function resetAll() {
    dbPromise = null;
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
      req.onblocked = () => reject(new Error("أغلق كل التبويبات الأخرى المفتوحة لهذا التطبيق ثم أعد المحاولة"));
    });
  }

  // ===== أرشيف سجل التقدّم: كل نسخة تسجيل سابقة (لا تُحذف عند إعادة التسجيل) =====
  async function saveHistoryEntry({ type, targetId, blob, duration, label }) {
    const db = await open();
    const rand = Math.random().toString(36).slice(2, 8);
    const id = `${type}_${targetId}_${Date.now()}_${rand}`;
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).put({
      id, type, targetId, blob, duration, label: label || "",
      mimeType: blob.type, createdAt: Date.now(),
    });
    return txDone(tx);
  }

  async function getHistoryForTarget(type, targetId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, "readonly");
      const idx = tx.objectStore(HISTORY_STORE).index("byTypeTarget");
      const req = idx.getAll(IDBKeyRange.only([type, targetId]));
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteHistoryEntry(id) {
    const db = await open();
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    tx.objectStore(HISTORY_STORE).delete(id);
    return txDone(tx);
  }

  async function clearHistoryForTarget(type, targetId) {
    const entries = await getHistoryForTarget(type, targetId);
    const db = await open();
    const tx = db.transaction(HISTORY_STORE, "readwrite");
    const store = tx.objectStore(HISTORY_STORE);
    entries.forEach((e) => store.delete(e.id));
    return txDone(tx);
  }

  return {
    saveRecording, getRecording, deleteRecording, hasRecording, getAllPageNumbers,
    saveSurahRecording, getSurahRecording, deleteSurahRecording, hasSurahRecording, getAllSurahNumbers,
    saveHizbRecording, getHizbRecording, deleteHizbRecording, hasHizbRecording, getAllHizbNumbers,
    saveTestRecording, getTestRecordingsForAttempt, getAllTestRecordingsForHizb, deleteTestRecording, deleteAttempt,
    getUsedQuestionIds, addUsedQuestionIds, resetUsedQuestionIds,
    saveHistoryEntry, getHistoryForTarget, deleteHistoryEntry, clearHistoryForTarget,
    getErrorMarks, saveErrorMarks, getAllErrorMarkPages,
    resetAll,
  };
})();
