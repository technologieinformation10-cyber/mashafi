/**
 * db.js — طبقة التخزين المحلي (IndexedDB)
 *
 * === إعادة تصميم معماري (v3) ===
 * لم يعد أي تسجيل يعتمد على رقم الصفحة وحده كمفتاح إطلاقًا. كل تسجيل الآن
 * مرتبط بسورة أولاً، ثم بالصفحات التي تخصّه:
 *
 *  - "surahRecordings"   تسجيل واحد متصل لكل سورة كاملة، مفتاحه رقم السورة
 *                         (1-114). كما كان سابقًا، مع إثراء الحقول الوصفية
 *                         (اسم السورة، صفحة البداية/النهاية، تاريخ التحديث).
 *
 *  - "pageRecordings"    تسجيل مستقل لكل صفحة *ضمن سورة معيّنة*. مفتاحه معرّف
 *                         مركّب "surahId_page" (مثال: "58_545"). هذا يحل مشكلة
 *                         الصفحات التي تضم أكثر من سورة (مثل صفحة 545: نهاية
 *                         سورة المجادلة + بداية سورة الحشر): تسجيل صفحة 545
 *                         الخاص بسورة المجادلة ("58_545") وتسجيل صفحة 545
 *                         الخاص بسورة الحشر ("59_545") يُخزَّنان بشكل مستقل
 *                         تمامًا ولا يتعارضان أو يستبدل أحدهما الآخر أبدًا،
 *                         مهما كان رقم الصفحة مشتركًا بينهما.
 *
 *  - "recordings"        (قديم/Legacy) — الشكل السابق قبل هذا الإصلاح:
 *                         تسجيل واحد لكل رقم صفحة فقط، دون أي معرفة بالسورة
 *                         (وهذا بالضبط ما كان يسبب استبدال تسجيل سورة بأخرى
 *                         عند تشارُكهما نفس الصفحة). يبقى هذا المخزن هنا فقط
 *                         ليقرأ منه التطبيق مرة واحدة عند أول تشغيل بعد
 *                         التحديث، وينقل بياناته تلقائيًا (انظر
 *                         migrateLegacyRecordings في app.js) إلى إمّا
 *                         "pageRecordings" مباشرة (إن كانت صفحته تخص سورة
 *                         واحدة فقط بلا لبس) أو إلى "pendingRecordings" (إن
 *                         كانت الصفحة تضم أكثر من سورة ولا يمكن معرفة أيّهما
 *                         قصد المستخدم تلقائيًا). بعد الترحيل يصبح فارغًا تمامًا
 *                         ولا يُستخدَم بعد ذلك إطلاقًا.
 *
 *  - "pendingRecordings" تسجيلات قديمة تعذّر ترحيلها تلقائيًا (لأن صفحتها
 *                         القديمة كانت تضم أكثر من سورة)، فتبقى هنا حتى يختار
 *                         المستخدم يدويًا السورة الصحيحة لها مرة واحدة فقط،
 *                         عندها تُنقَل إلى "pageRecordings" وتُحذف من هنا.
 *
 * لا يعتمد على أي اتصال بالإنترنت — كل شيء محفوظ على الجهاز فقط.
 */

const QuranDB = (() => {
  const DB_NAME = "quranReviewDB";
  const DB_VERSION = 3;

  const LEGACY_PAGE_STORE = "recordings";
  const PAGE_STORE = "pageRecordings";
  const SURAH_STORE = "surahRecordings";
  const PENDING_STORE = "pendingRecordings";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // القديم: يُبقى كما هو تمامًا بلا أي تعديل على شكله، ليقرأ منه
        // الترحيل التلقائي (app.js) قبل أن يفرغ ويصبح غير مستخدَم.
        if (!db.objectStoreNames.contains(LEGACY_PAGE_STORE)) {
          db.createObjectStore(LEGACY_PAGE_STORE, { keyPath: "page" });
        }

        if (!db.objectStoreNames.contains(SURAH_STORE)) {
          db.createObjectStore(SURAH_STORE, { keyPath: "surah" });
        }

        if (!db.objectStoreNames.contains(PAGE_STORE)) {
          const store = db.createObjectStore(PAGE_STORE, { keyPath: "id" });
          store.createIndex("by_page", "page", { unique: false });
          store.createIndex("by_surah", "surahId", { unique: false });
        }

        if (!db.objectStoreNames.contains(PENDING_STORE)) {
          db.createObjectStore(PENDING_STORE, { keyPath: "page" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  // معرّف فريد دائمًا: يجمع رقم السورة مع رقم الصفحة، فلا يتعارض أبدًا مع
  // تسجيل صفحة أخرى من سورة مختلفة حتى لو كان رقم الصفحة نفسه.
  function pageRecordId(surahId, page) {
    return `${surahId}_${page}`;
  }

  // ===================================================================
  // تسجيلات صفحات ضمن سورة (الجديد — يحل محل "recordings" القديم)
  // ===================================================================

  async function savePageRecording({ surahId, surahName, page, startPage, endPage, blob, duration }) {
    if (surahId == null || page == null) {
      throw new Error("savePageRecording: surahId و page مطلوبان");
    }
    const db = await open();
    const id = pageRecordId(surahId, page);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGE_STORE, "readwrite");
      const store = tx.objectStore(PAGE_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const prev = getReq.result;
        const now = Date.now();
        store.put({
          id,
          surahId,
          surahName: surahName || null,
          page,
          startPage: startPage != null ? startPage : page,
          endPage: endPage != null ? endPage : page,
          // لا يوجد حاليًا مصدر بيانات لأرقام الآيات في هذا التطبيق (رواية
          // ورش لها تقسيم آيات مختلف عن حفص)، فتُترك محجوزة لتوسّع مستقبلي.
          startAyah: null,
          endAyah: null,
          duration,
          mimeType: blob.type,
          blob,
          createdAt: (prev && prev.createdAt) || now,
          updatedAt: now,
        });
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getPageRecordingById(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGE_STORE, "readonly");
      const req = tx.objectStore(PAGE_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getPageRecording(surahId, page) {
    return getPageRecordingById(pageRecordId(surahId, page));
  }

  async function deletePageRecordingById(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGE_STORE, "readwrite");
      tx.objectStore(PAGE_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function deletePageRecording(surahId, page) {
    return deletePageRecordingById(pageRecordId(surahId, page));
  }

  // كل تسجيلات الصفحات الموجودة لصفحة معيّنة (قد تكون أكثر من واحد إن
  // كانت الصفحة تضم أكثر من سورة).
  async function getRecordingsForPage(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGE_STORE, "readonly");
      const req = tx.objectStore(PAGE_STORE).index("by_page").getAll(page);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllPageRecordings() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PAGE_STORE, "readonly");
      const req = tx.objectStore(PAGE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ===================================================================
  // تسجيلات السور الكاملة (المفتاح كما هو: رقم السورة فقط)
  // ===================================================================

  async function saveSurahRecording(surah, blob, duration, meta) {
    meta = meta || {};
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SURAH_STORE, "readwrite");
      const store = tx.objectStore(SURAH_STORE);
      const getReq = store.get(surah);
      getReq.onsuccess = () => {
        const prev = getReq.result;
        const now = Date.now();
        store.put({
          surah,
          surahId: surah,
          surahName: meta.surahName || null,
          startPage: meta.startPage != null ? meta.startPage : null,
          endPage: meta.endPage != null ? meta.endPage : null,
          startAyah: null,
          endAyah: null,
          blob,
          duration,
          mimeType: blob.type,
          createdAt: (prev && prev.createdAt) || now,
          updatedAt: now,
        });
      };
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

  // ===================================================================
  // القديم (Legacy) — قراءة وحذف لغرض الترحيل التلقائي فقط
  // ===================================================================

  async function getAllLegacyPageRecordings() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEGACY_PAGE_STORE, "readonly");
      const req = tx.objectStore(LEGACY_PAGE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteLegacyPageRecording(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEGACY_PAGE_STORE, "readwrite");
      tx.objectStore(LEGACY_PAGE_STORE).delete(page);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ===================================================================
  // تسجيلات بانتظار تعيين السورة يدويًا (نتيجة ترحيل غامض)
  // ===================================================================

  async function savePendingRecording(entry) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, "readwrite");
      tx.objectStore(PENDING_STORE).put(entry);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllPendingRecordings() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, "readonly");
      const req = tx.objectStore(PENDING_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deletePendingRecording(page) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, "readwrite");
      tx.objectStore(PENDING_STORE).delete(page);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  return {
    // تسجيلات صفحات ضمن سورة (الجديد)
    savePageRecording, getPageRecording, getPageRecordingById,
    deletePageRecording, deletePageRecordingById,
    getRecordingsForPage, getAllPageRecordings,
    // تسجيلات سور كاملة
    saveSurahRecording, getSurahRecording, deleteSurahRecording,
    hasSurahRecording, getAllSurahNumbers,
    // قديم/ترحيل
    getAllLegacyPageRecordings, deleteLegacyPageRecording,
    // بانتظار تعيين يدوي
    savePendingRecording, getAllPendingRecordings, deletePendingRecording,
  };
})();

// يتيح اختبار هذا الملف تلقائيًا خارج المتصفح (Node + fake-indexeddb) دون أي
// تأثير على عمله داخل المتصفح (typeof module غير معرّف هناك).
if (typeof module !== "undefined" && module.exports) {
  module.exports = QuranDB;
}
