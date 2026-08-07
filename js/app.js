/**
 * app.js — منطق تطبيق مراجعة وحفظ القرآن
 * يعمل بالكامل محليًا بدون إنترنت. التسجيلات تُحفظ في IndexedDB
 * عبر db.js وتُشغَّل من نفس الجهاز حتى بعد إغلاق التطبيق.
 *
 * أربع طبقات تسجيل/تشغيل واختبار:
 *  - وضع "صفحة": تسجيل مستقل لكل صفحة.
 *  - وضع "سورة كاملة": تسجيل متصل واحد يغطي كل صفحات السورة.
 *  - وضع "حزب كامل": تسجيل متصل واحد يغطي كل صفحات الحزب (جديد).
 *  - "قائمة الاستماع": اختيار عدة مقاطع (صفحات/سور/أحزاب) وتشغيلها تباعًا،
 *    مع تحكّم كامل لكل عنصر (تشغيل/إيقاف مؤقت/إعادة/إعادة تسجيل/حذف).
 *  - "اختبار حفظ الأحزاب": اختبار تسميع صوتي بلا تصحيح آلي (جديد).
 */

(() => {
  "use strict";

  const TOTAL_PAGES = 604;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 62; // نفس نصف قطر دائرة الـ SVG
  const QUESTIONS_PER_ATTEMPT = 30;
  const PAGE_TRANSITION_MS = 120; // مدة كل شطر من انتقال تقليب الصفحة (خروج/دخول) — تُلغى تلقائيًا مع إعداد "تقليل الحركة"
  const MC_DAY_MS = 24 * 60 * 60 * 1000;
  const MC_REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30]; // بطاقات الأخطاء الذكية: سلّم التكرار المتباعد (جديد)

  // أي خطأ غير متوقّع (بما فيه أخطاء لم تُتوقَّع أثناء الكتابة) يظهر كرسالة قصيرة
  // بدل أن يفشل الزر بصمت دون أي إشارة لسبب المشكلة — يسهّل هذا اكتشاف أي عطل
  // فعلي يظهر لاحقًا على أجهزة/متصفحات مختلفة.
  window.addEventListener("error", (e) => {
    console.error("خطأ غير متوقع:", e.error || e.message);
    showToastSafe("حدث خطأ غير متوقع: " + ((e.error && e.error.message) || e.message || "غير معروف"));
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("خطأ غير معالَج (Promise):", e.reason);
    showToastSafe("حدث خطأ غير متوقع: " + ((e.reason && e.reason.message) || String(e.reason)));
  });
  function showToastSafe(msg) {
    try { showToast(msg); } catch (e) { /* toast نفسه غير متاح بعد */ }
  }

  // ===== عناصر DOM =====
  const el = {
    modeTabs: document.getElementById("modeTabs"),
    modePageBtn: document.getElementById("modePageBtn"),
    modeSurahBtn: document.getElementById("modeSurahBtn"),
    modeHizbBtn: document.getElementById("modeHizbBtn"),

    pageNav: document.getElementById("pageNav"),
    pageInput: document.getElementById("pageInput"),
    pagePicker: document.getElementById("pagePicker"),
    surahPicker: document.getElementById("surahPicker"),
    surahSelect: document.getElementById("surahSelect"),
    surahRange: document.getElementById("surahRange"),
    surahRangeControls: document.getElementById("surahRangeControls"),
    surahShrinkBtn: document.getElementById("surahShrinkBtn"),
    surahExtendBtn: document.getElementById("surahExtendBtn"),
    hizbPicker: document.getElementById("hizbPicker"),
    hizbSelect: document.getElementById("hizbSelect"),
    hizbRange: document.getElementById("hizbRange"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageNumberLabel: document.getElementById("pageNumberLabel"),
    recordedBadge: document.getElementById("recordedBadge"),

    pageImageWrap: document.getElementById("pageImageWrap"),
    pageImage: document.getElementById("pageImage"),
    pageImagePlaceholder: document.getElementById("pageImagePlaceholder"),
    errorMarksLayer: document.getElementById("errorMarksLayer"),
    errorCountBadge: document.getElementById("errorCountBadge"),
    markErrorModeBtn: document.getElementById("markErrorModeBtn"),
    markModeHint: document.getElementById("markModeHint"),
    errorStatsBtn: document.getElementById("errorStatsBtn"),
    errorStatsModal: document.getElementById("errorStatsModal"),
    closeErrorStatsModal: document.getElementById("closeErrorStatsModal"),
    errorStatsBody: document.getElementById("errorStatsBody"),
    errorStatsList: document.getElementById("errorStatsList"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightboxImg"),

    // بطاقات الأخطاء الذكية (جديد)
    mistakeCardIndicator: document.getElementById("mistakeCardIndicator"),
    mistakeCardIndicatorCount: document.getElementById("mistakeCardIndicatorCount"),
    floatingCardLayer: document.getElementById("floatingCardLayer"),
    createMistakeCardBtn: document.getElementById("createMistakeCardBtn"),
    mistakeCardsBtn: document.getElementById("mistakeCardsBtn"),
    reviewMistakesBtn: document.getElementById("reviewMistakesBtn"),
    mistakeStatsBtn: document.getElementById("mistakeStatsBtn"),

    createMistakeCardModal: document.getElementById("createMistakeCardModal"),
    mcModalTitle: document.getElementById("mcModalTitle"),
    closeCreateMistakeCardModal: document.getElementById("closeCreateMistakeCardModal"),
    mcModalBody: document.getElementById("mcModalBody"),
    mcSurahPageLabel: document.getElementById("mcSurahPageLabel"),
    mcAyahSelect: document.getElementById("mcAyahSelect"),
    mcAyahText: document.getElementById("mcAyahText"),
    mcAutoFillHint: document.getElementById("mcAutoFillHint"),
    mcWordPicker: document.getElementById("mcWordPicker"),
    mcNoteText: document.getElementById("mcNoteText"),
    mcEditingCardId: document.getElementById("mcEditingCardId"),
    mcCardPage: document.getElementById("mcCardPage"),
    mcCancelBtn: document.getElementById("mcCancelBtn"),
    mcSaveBtn: document.getElementById("mcSaveBtn"),

    mistakeCardsModal: document.getElementById("mistakeCardsModal"),
    closeMistakeCardsModal: document.getElementById("closeMistakeCardsModal"),
    mcSearchInput: document.getElementById("mcSearchInput"),
    mcFilterScope: document.getElementById("mcFilterScope"),
    mcSortSelect: document.getElementById("mcSortSelect"),
    mcShowMasteredToggle: document.getElementById("mcShowMasteredToggle"),
    mistakeCardsListBody: document.getElementById("mistakeCardsListBody"),
    mistakeCardsList: document.getElementById("mistakeCardsList"),

    reviewMistakesModal: document.getElementById("reviewMistakesModal"),
    closeReviewMistakesModal: document.getElementById("closeReviewMistakesModal"),
    reviewSetup: document.getElementById("reviewSetup"),
    reviewDueCount: document.getElementById("reviewDueCount"),
    reviewStartBtn: document.getElementById("reviewStartBtn"),
    reviewRun: document.getElementById("reviewRun"),
    reviewProgressText: document.getElementById("reviewProgressText"),
    reviewProgressFill: document.getElementById("reviewProgressFill"),
    reviewCardMeta: document.getElementById("reviewCardMeta"),
    reviewCardAyahText: document.getElementById("reviewCardAyahText"),
    reviewCardNote: document.getElementById("reviewCardNote"),
    reviewViewPageBtn: document.getElementById("reviewViewPageBtn"),
    reviewStillWrongBtn: document.getElementById("reviewStillWrongBtn"),
    reviewMasteredBtn: document.getElementById("reviewMasteredBtn"),
    reviewDone: document.getElementById("reviewDone"),
    reviewCloseAfterDoneBtn: document.getElementById("reviewCloseAfterDoneBtn"),

    mistakeStatsModal: document.getElementById("mistakeStatsModal"),
    closeMistakeStatsModal: document.getElementById("closeMistakeStatsModal"),
    mistakeStatsBody: document.getElementById("mistakeStatsBody"),
    mcStatsGrid: document.getElementById("mcStatsGrid"),
    mcTopSurahsList: document.getElementById("mcTopSurahsList"),
    mcTopWordsList: document.getElementById("mcTopWordsList"),

    playBtn: document.getElementById("playBtn"),
    playIcon: document.getElementById("playIcon"),
    pauseIcon: document.getElementById("pauseIcon"),
    ringProgress: document.getElementById("ringProgress"),
    repeatInfo: document.getElementById("repeatInfo"),

    curTime: document.getElementById("curTime"),
    durTime: document.getElementById("durTime"),
    seekBar: document.getElementById("seekBar"),

    recordRow: document.getElementById("recordRow"),
    recordBtn: document.getElementById("recordBtn"),
    recordBtnText: document.getElementById("recordBtnText"),
    pauseRecordBtn: document.getElementById("pauseRecordBtn"),
    pauseRecordIcon: document.getElementById("pauseRecordIcon"),
    pauseRecordBtnText: document.getElementById("pauseRecordBtnText"),
    recPausedBadge: document.getElementById("recPausedBadge"),
    stopRecordBtn: document.getElementById("stopRecordBtn"),
    recTimer: document.getElementById("recTimer"),
    surahRecordHint: document.getElementById("surahRecordHint"),

    stopBtn: document.getElementById("stopBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    downloadBtn: document.getElementById("downloadBtn"),

    speedRow: document.getElementById("speedRow"),
    repeatRow: document.getElementById("repeatRow"),

    playlistBtn: document.getElementById("playlistBtn"),
    quizBtn: document.getElementById("quizBtn"),
    quizModal: document.getElementById("quizModal"),
    closeQuizModal: document.getElementById("closeQuizModal"),
    quizJuzSelect: document.getElementById("quizJuzSelect"),
    quizStartBtn: document.getElementById("quizStartBtn"),
    quizBody: document.getElementById("quizBody"),
    quizSequence: document.getElementById("quizSequence"),
    quizChips: document.getElementById("quizChips"),
    quizResult: document.getElementById("quizResult"),
    quizResetBtn: document.getElementById("quizResetBtn"),
    quizCheckBtn: document.getElementById("quizCheckBtn"),
    playlistModal: document.getElementById("playlistModal"),
    closePlaylistModal: document.getElementById("closePlaylistModal"),
    playlistBody: document.getElementById("playlistBody"),
    clearPlaylistBtn: document.getElementById("clearPlaylistBtn"),
    startPlaylistBtn: document.getElementById("startPlaylistBtn"),

    queueBar: document.getElementById("queueBar"),
    queuePosition: document.getElementById("queuePosition"),
    queueLabel: document.getElementById("queueLabel"),
    queuePrevBtn: document.getElementById("queuePrevBtn"),
    queueNextBtn: document.getElementById("queueNextBtn"),
    queueStopBtn: document.getElementById("queueStopBtn"),

    toast: document.getElementById("toast"),
    fileProtocolWarning: document.getElementById("fileProtocolWarning"),
    dismissFileWarning: document.getElementById("dismissFileWarning"),

    // نافذة التأكيد العامة
    confirmModal: document.getElementById("confirmModal"),
    confirmMessage: document.getElementById("confirmMessage"),
    confirmCancelBtn: document.getElementById("confirmCancelBtn"),
    confirmOkBtn: document.getElementById("confirmOkBtn"),

    // اختبار حفظ الأحزاب
    hizbTestBtn: document.getElementById("hizbTestBtn"),
    hizbTestModal: document.getElementById("hizbTestModal"),
    closeHizbTestModal: document.getElementById("closeHizbTestModal"),
    hizbTestSetup: document.getElementById("hizbTestSetup"),
    hizbTestSelect: document.getElementById("hizbTestSelect"),
    hizbTestStartBtn: document.getElementById("hizbTestStartBtn"),
    hizbTestCoverage: document.getElementById("hizbTestCoverage"),
    hizbTestRun: document.getElementById("hizbTestRun"),
    hizbTestProgressText: document.getElementById("hizbTestProgressText"),
    hizbTestProgressFill: document.getElementById("hizbTestProgressFill"),
    hizbTestQMeta: document.getElementById("hizbTestQMeta"),
    hizbTestPrefixText: document.getElementById("hizbTestPrefixText"),
    hizbTestViewPageBtn: document.getElementById("hizbTestViewPageBtn"),
    hizbAnswerRecordBtn: document.getElementById("hizbAnswerRecordBtn"),
    hizbAnswerStopBtn: document.getElementById("hizbAnswerStopBtn"),
    hizbAnswerTimer: document.getElementById("hizbAnswerTimer"),
    hizbTestSkipBtn: document.getElementById("hizbTestSkipBtn"),
    hizbTestNextBtn: document.getElementById("hizbTestNextBtn"),
    hizbTestEndEarlyBtn: document.getElementById("hizbTestEndEarlyBtn"),
    hizbTestReview: document.getElementById("hizbTestReview"),
    hizbTestReviewList: document.getElementById("hizbTestReviewList"),
    hizbTestNewAttemptBtn: document.getElementById("hizbTestNewAttemptBtn"),

    // حالة الحفظ
    reminderBtn: document.getElementById("reminderBtn"),
    reminderModal: document.getElementById("reminderModal"),
    closeReminderModal: document.getElementById("closeReminderModal"),
    reminderBody: document.getElementById("reminderBody"),
    statusSummaryRow: document.getElementById("statusSummaryRow"),
    statusGrid: document.getElementById("statusGrid"),

    // سجل التقدّم الصوتي
    progressLogBtn: document.getElementById("progressLogBtn"),
    progressLogModal: document.getElementById("progressLogModal"),
    closeProgressLogModal: document.getElementById("closeProgressLogModal"),
    progressLogTargetLabel: document.getElementById("progressLogTargetLabel"),
    progressLogBody: document.getElementById("progressLogBody"),
    progressLogCompareRow: document.getElementById("progressLogCompareRow"),
    compareOldestNewestBtn: document.getElementById("compareOldestNewestBtn"),
    progressLogList: document.getElementById("progressLogList"),
  };

  // ===== الحالة =====
  const state = {
    mode: "page", // "page" | "surah" | "hizb"
    currentPage: 1,
    currentSurah: null, // عنصر من QURAN_SURAHS عند وضع السورة
    currentHizb: null, // عنصر من QURAN_AHZAB عند وضع الحزب
    recordTarget: { type: "page", id: 1 },

    mediaRecorder: null,
    chunks: [],
    recordStartTime: 0,
    recordElapsedBeforePause: 0, // مجموع ثواني التسجيل الفعلية المتراكمة من مقاطع سابقة قبل أي إيقاف مؤقت حالي
    recordFinalDuration: 0, // يُحسب لحظة الإيقاف النهائي (قبل أن تصبح حالة المسجّل غير نشطة) ليُستخدم عند الحفظ
    recordTimerHandle: null,
    stream: null,

    audio: new Audio(),
    currentObjectUrl: null,
    currentRecMime: null,
    hasRecording: false,

    playbackRate: 1,
    repeatTarget: 1, // رقم أو Infinity
    repeatDone: 0,
    isPlaying: false,

    playlistSelection: [], // [{type:'page'|'surah'|'hizb', id, label}] بترتيب الاختيار
    quiz: { juz: null, correctOrder: [], sequence: [], checked: false },
    queue: null, // { items: [...], index }

    // معاينة سريعة لعنصر واحد داخل قائمة الاستماع (منفصلة عن مشغّل الصفحة الرئيسي)
    preview: { audio: new Audio(), type: null, id: null, url: null },

    // معاينة نسخة واحدة من سجل التقدّم (منفصلة عن كل ما سبق)
    historyPreview: { audio: new Audio(), entryId: null, btn: null, url: null },

    // اختبار حفظ الأحزاب
    hizbTest: {
      hizb: null, attemptId: null, questions: [], index: 0,
      answers: {}, // qid -> {blob, duration, mimeType}
    },
    testMediaRecorder: null, testChunks: [], testRecordStart: 0, testRecordTimerHandle: null, testStream: null,

    // بطاقات الأخطاء الذكية (جديد)
    mc: {
      editingId: null,          // معرّف البطاقة قيد التعديل، أو null عند إنشاء بطاقة جديدة
      markedWords: new Set(),   // الكلمات المحدَّدة كموضع خطأ داخل نافذة الإنشاء/التعديل
      autoFilledText: null,     // آخر نص اقتُرح تلقائيًا، لتفادي الكتابة فوق تعديل المستخدم اليدوي
      openFloating: null,       // { page, cards, index } — البطاقات العائمة المفتوحة حاليًا فوق الصفحة
      reviewQueue: [],          // بطاقات جلسة "راجع أخطائي" الحالية
      reviewIndex: 0,
    },
  };

  state.audio.preservesPitch = true;
  state.audio.mozPreservesPitch = true;
  state.audio.webkitPreservesPitch = true;

  // ===== أدوات مساعدة عامة =====
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  const ARABIC_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  // تنسيق يدوي بأرقام عادية (0-9) بدل الأرقام الهندية التي قد تُنتجها toLocaleDateString
  // تلقائيًا حسب لغة النظام — للحفاظ على نفس نمط الأرقام المستخدم في بقية التطبيق
  function formatArabicDate(timestamp) {
    const d = new Date(timestamp);
    return `${d.getDate()} ${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function pageImageSrc(pageNum) {
    return `page-${pageNum}.jpg`;
  }

  // انتقال بصري سلس بين صورتي صفحة متتاليتين (تأثير بصري بحت — لا يمسّ الصوت أو التسجيل إطلاقًا).
  // يعمل بتبديل صنفَي CSS فقط (بلا مضاعفة عناصر DOM)، ويُلغى تلقائيًا مع إعداد "تقليل الحركة" في النظام.
  let pageTransitionTimer = null;
  function runPageTransition(direction, applyFn) {
    const img = el.pageImage;
    if (pageTransitionTimer) { clearTimeout(pageTransitionTimer); pageTransitionTimer = null; }
    img.classList.remove("pg-shift-left", "pg-shift-right");
    const exitClass = direction === "next" ? "pg-shift-left" : "pg-shift-right";
    const enterClass = direction === "next" ? "pg-shift-right" : "pg-shift-left";
    void img.offsetWidth; // إجبار إعادة رسم فورية حتى تبدأ حركة الخروج من نقطة الصفر في كل مرة
    img.classList.add(exitClass);
    pageTransitionTimer = window.setTimeout(() => {
      pageTransitionTimer = null;
      img.classList.remove(exitClass);
      applyFn();
      img.classList.add(enterClass);
      void img.offsetWidth;
      img.classList.remove(enterClass);
      window.setTimeout(() => mainMarkController.reposition(), PAGE_TRANSITION_MS + 20);
    }, PAGE_TRANSITION_MS);
  }

  // pageNum: رقم الصفحة المطلوب عرضها.
  // direction: اختياري — "next" أو "prev". يُمرَّر فقط عند التنقّل (أزرار/سحب) لتفعيل
  // انتقال سلس؛ عند تركه فارغًا (كل الاستدعاءات الحالية عند فتح صفحة/سورة/حزب لأول مرة)
  // يبقى السلوك تبديلاً فوريًا كما كان تمامًا دون أي تغيير.
  function loadPageImage(pageNum, direction) {
    const src = pageImageSrc(pageNum);
    const tester = new Image();
    const showImage = () => {
      if (state.currentPage !== pageNum) return;
      el.pageImage.src = src;
      el.pageImage.classList.remove("hidden");
      el.pageImagePlaceholder.classList.add("hidden");
      el.pageImageWrap.classList.add("has-image");
      mainMarkController.reposition();
    };
    const showMissing = () => {
      if (state.currentPage !== pageNum) return;
      el.pageImage.classList.add("hidden");
      el.pageImage.removeAttribute("src");
      el.pageImagePlaceholder.classList.remove("hidden");
      el.pageImageWrap.classList.remove("has-image");
    };
    if (direction) {
      tester.onload = () => runPageTransition(direction, showImage);
      tester.onerror = () => runPageTransition(direction, showMissing);
    } else {
      tester.onload = showImage;
      tester.onerror = showMissing;
    }
    tester.src = src;
    loadErrorMarksForPage(pageNum);
    refreshMistakeIndicatorForPage(pageNum); // بطاقات الأخطاء الذكية (جديد)
  }

  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add("hidden"), 2200);
  }

  function setRing(fraction) {
    const offset = RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)));
    el.ringProgress.style.strokeDashoffset = offset;
  }

  function updateRepeatInfo() {
    if (state.repeatTarget === Infinity) {
      el.repeatInfo.textContent = state.isPlaying || state.repeatDone > 0
        ? `التكرار: بلا حدود (تم ${state.repeatDone})`
        : "التكرار: بلا حدود";
    } else if (state.repeatTarget === 1) {
      el.repeatInfo.textContent = "التكرار: مرة واحدة";
    } else {
      el.repeatInfo.textContent = `التكرار: ${Math.min(state.repeatDone + 1, state.repeatTarget)} من ${state.repeatTarget}`;
    }
  }

  // خطأ بنيوي معروف: قاعدة بيانات محلية قديمة (من نسخة سابقة من التطبيق) ينقصها
  // أحد الجداول الجديدة. الترقية التلقائية تُصلح هذا عادةً بمجرد تحديث رقم
  // إصدار قاعدة البيانات، لكن نوفّر أيضًا مسارًا يدويًا صريحًا للتعافي الفوري
  // دون انتظار تحديث الصفحة، تحسّبًا لأي حالة غير متوقعة.
  function isStructuralDbError(err) {
    const msg = (err && (err.message || String(err))) || "";
    return (err && err.name === "NotFoundError") || /object stores? was not found/i.test(msg);
  }

  function renderDbRecoveryAction(container, err) {
    container.innerHTML = "";
    const p = document.createElement("p");
    p.className = "playlist-empty";
    p.textContent = "حدثت مشكلة في قاعدة البيانات المحلية القديمة على هذا الجهاز (رسالة النظام: " +
      ((err && err.message) || "") + "). عادة يكفي تحديث الصفحة لإصلاحها تلقائيًا.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctrl-btn primary";
    btn.style.margin = "10px auto";
    btn.style.display = "block";
    btn.textContent = "إصلاح فوري (تحديث الصفحة)";
    btn.addEventListener("click", () => window.location.reload());
    const btn2 = document.createElement("button");
    btn2.type = "button";
    btn2.className = "ctrl-btn danger";
    btn2.style.margin = "8px auto 0";
    btn2.style.display = "block";
    btn2.textContent = "لم يُجدِ ذلك؟ إعادة ضبط كل التسجيلات المحفوظة محليًا";
    btn2.addEventListener("click", async () => {
      const ok = await showConfirm("سيؤدي هذا لحذف كل التسجيلات الصوتية المحفوظة على هذا الجهاز نهائيًا، ولا يمكن التراجع عنه. هل تريد المتابعة؟");
      if (!ok) return;
      try {
        await QuranDB.resetAll();
        window.location.reload();
      } catch (e) {
        showToast("تعذّر إعادة الضبط: " + ((e && e.message) || "أغلق التبويبات الأخرى لهذا التطبيق وأعد المحاولة"));
      }
    });
    container.appendChild(p);
    container.appendChild(btn);
    container.appendChild(btn2);
  }

  // ===== نافذة تأكيد عامة (تُستبدل بها confirm() الافتراضية للحذف) =====
  function showConfirm(message) {
    return new Promise((resolve) => {
      el.confirmMessage.textContent = message;
      el.confirmModal.classList.remove("hidden");
      const cleanup = (result) => {
        el.confirmModal.classList.add("hidden");
        el.confirmOkBtn.removeEventListener("click", onOk);
        el.confirmCancelBtn.removeEventListener("click", onCancel);
        el.confirmModal.removeEventListener("click", onOverlay);
        resolve(result);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onOverlay = (e) => { if (e.target === el.confirmModal) cleanup(false); };
      el.confirmOkBtn.addEventListener("click", onOk);
      el.confirmCancelBtn.addEventListener("click", onCancel);
      el.confirmModal.addEventListener("click", onOverlay);
    });
  }

  // ===== تحميل/إرسال التسجيلات (لإرسالها للمعلّمة) =====
  function extFromMime(mime) {
    if (!mime) return "webm";
    if (mime.includes("mp4")) return "m4a";
    if (mime.includes("ogg")) return "ogg";
    return "webm";
  }

  function sanitizeFileName(str) {
    return String(str).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  }

  function buildRecordingFileName(type, id, mime) {
    const ext = extFromMime(mime);
    if (type === "surah") {
      const surah = surahByNumber(id);
      const name = surah ? sanitizeFileName(surah.name) : id;
      return `سورة-${id}-${name}.${ext}`;
    }
    if (type === "hizb") {
      const hizb = hizbByNumber(id);
      const name = hizb ? sanitizeFileName(hizb.name) : id;
      return `${name}.${ext}`;
    }
    return `صفحة-${id}.${ext}`;
  }

  function triggerDownload(blobOrUrl, filename) {
    const isBlob = blobOrUrl instanceof Blob;
    const url = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (isBlob) setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // يحاول فتح قائمة المشاركة مباشرة (لإرسال الملف عبر واتساب مثلًا للمعلّمة)
  // فإن تعذّر ذلك (حاسوب، أو متصفح لا يدعمها)، يقوم بتحميل الملف عاديًا
  async function shareOrDownloadBlob(blob, filename, shareTitle) {
    try {
      const file = new File([blob], filename, { type: blob.type || "audio/webm" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle || filename });
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return; // ألغى المستخدم المشاركة
    }
    triggerDownload(blob, filename);
  }

  async function getRecordByType(type, id) {
    if (type === "surah") return QuranDB.getSurahRecording(id);
    if (type === "hizb") return QuranDB.getHizbRecording(id);
    return QuranDB.getRecording(id);
  }
  async function deleteRecordByType(type, id) {
    if (type === "surah") return QuranDB.deleteSurahRecording(id);
    if (type === "hizb") return QuranDB.deleteHizbRecording(id);
    return QuranDB.deleteRecording(id);
  }

  async function downloadRecordingFor(type, id, label) {
    const rec = await getRecordByType(type, id);
    if (!rec || !rec.blob) {
      showToast("لا يوجد تسجيل لتحميله");
      return;
    }
    const filename = buildRecordingFileName(type, id, rec.mimeType || rec.blob.type);
    await shareOrDownloadBlob(rec.blob, filename, label);
  }

  function downloadIconSVG() {
    return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path fill="currentColor" d="M12 3v10.5m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>
    </svg>`;
  }

  // ===== اختبار ترتيب السور في كل جزء (ميزة موجودة سابقًا — بلا تغيير) =====
  function populateQuizJuzSelect() {
    el.quizJuzSelect.innerHTML = "";
    QURAN_JUZ.forEach((j) => {
      const opt = document.createElement("option");
      opt.value = String(j.number);
      opt.textContent = `الجزء ${j.number}`;
      el.quizJuzSelect.appendChild(opt);
    });
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function juzByNumber(n) {
    return QURAN_JUZ.find((j) => j.number === n);
  }

  function startQuiz() {
    const juzNum = parseInt(el.quizJuzSelect.value, 10);
    const juz = juzByNumber(juzNum);
    if (!juz) return;
    state.quiz = {
      juz: juzNum,
      correctOrder: juz.surahs.slice(),
      sequence: [],
      shuffled: shuffleArray(juz.surahs),
      checked: false,
    };
    renderQuiz();
  }

  function renderQuiz() {
    const q = state.quiz;
    el.quizResult.classList.add("hidden");
    el.quizResult.textContent = "";
    el.quizResult.className = "quiz-result hidden";

    el.quizSequence.innerHTML = "";
    if (q.sequence.length === 0) {
      const hint = document.createElement("span");
      hint.className = "quiz-empty-hint";
      hint.textContent = "اضغط على السور بالأسفل بالترتيب الصحيح…";
      el.quizSequence.appendChild(hint);
    } else {
      q.sequence.forEach((num, idx) => {
        const surah = surahByNumber(num);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "quiz-chip placed";
        chip.textContent = `${idx + 1}. سورة ${surah ? surah.name : num}`;
        if (!q.checked) {
          chip.addEventListener("click", () => {
            state.quiz.sequence = state.quiz.sequence.filter((n) => n !== num);
            renderQuiz();
          });
        }
        el.quizSequence.appendChild(chip);
      });
    }

    el.quizChips.innerHTML = "";
    const remaining = q.shuffled.filter((n) => !q.sequence.includes(n));
    remaining.forEach((num) => {
      const surah = surahByNumber(num);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "quiz-chip";
      chip.textContent = `سورة ${surah ? surah.name : num}`;
      chip.addEventListener("click", () => {
        state.quiz.sequence.push(num);
        renderQuiz();
      });
      el.quizChips.appendChild(chip);
    });

    el.quizCheckBtn.disabled = q.sequence.length !== q.correctOrder.length || q.checked;
  }

  function checkQuiz() {
    const q = state.quiz;
    if (q.sequence.length !== q.correctOrder.length) return;
    q.checked = true;
    let correctCount = 0;
    const chips = el.quizSequence.querySelectorAll(".quiz-chip");
    q.sequence.forEach((num, idx) => {
      const ok = num === q.correctOrder[idx];
      if (ok) correctCount++;
      if (chips[idx]) chips[idx].classList.add(ok ? "correct" : "wrong");
    });
    el.quizResult.classList.remove("hidden");
    if (correctCount === q.correctOrder.length) {
      el.quizResult.className = "quiz-result success";
      el.quizResult.textContent = "أحسنت! الترتيب صحيح تمامًا 🎉";
    } else {
      el.quizResult.className = "quiz-result fail";
      const correctNames = q.correctOrder.map((n) => {
        const s = surahByNumber(n);
        return s ? s.name : n;
      }).join(" ← ");
      el.quizResult.textContent = `الترتيب الصحيح غير مكتمل (${correctCount} من ${q.correctOrder.length} في مكانها الصحيح). الترتيب الصحيح: ${correctNames}`;
    }
    el.quizCheckBtn.disabled = true;
  }

  // ===== أدوات السور =====
  const SURAH_OVERRIDES_KEY = "quran-surah-overrides";

  function loadSurahOverrides() {
    let overrides = {};
    try { overrides = JSON.parse(localStorage.getItem(SURAH_OVERRIDES_KEY) || "{}"); } catch (e) { overrides = {}; }
    Object.keys(overrides).forEach((key) => {
      const surah = surahByNumber(parseInt(key, 10));
      const o = overrides[key];
      if (!surah || !o || typeof o.endPage !== "number") return;
      if (o.endPage >= surah.startPage && o.endPage <= TOTAL_PAGES) {
        surah.endPage = o.endPage;
      }
    });
  }

  function saveSurahOverride(surahNumber, endPage) {
    let overrides = {};
    try { overrides = JSON.parse(localStorage.getItem(SURAH_OVERRIDES_KEY) || "{}"); } catch (e) { overrides = {}; }
    overrides[surahNumber] = { endPage };
    try { localStorage.setItem(SURAH_OVERRIDES_KEY, JSON.stringify(overrides)); } catch (e) { /* تجاهل */ }
  }

  function surahByNumber(n) {
    return QURAN_SURAHS.find((s) => s.number === n) || null;
  }
  function surahForPage(p) {
    return QURAN_SURAHS.find((s) => p >= s.startPage && p <= s.endPage) || QURAN_SURAHS[0];
  }
  function populateSurahSelect() {
    const frag = document.createDocumentFragment();
    QURAN_SURAHS.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = String(s.number);
      opt.textContent = `${s.number}. ${s.name}`;
      frag.appendChild(opt);
    });
    el.surahSelect.appendChild(frag);
  }

  // ===== أدوات الأحزاب (جديد) =====
  function hizbByNumber(n) {
    return QURAN_AHZAB.find((h) => h.number === n) || null;
  }
  function hizbForPage(p) {
    return QURAN_AHZAB.find((h) => p >= h.startPage && p <= h.endPage) || QURAN_AHZAB[0];
  }
  function juzForPage(p) {
    return QURAN_JUZ.find((j) => p >= j.startPage && p <= j.endPage) || QURAN_JUZ[0];
  }
  function populateHizbSelect(selectEl) {
    selectEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    QURAN_AHZAB.forEach((h) => {
      const opt = document.createElement("option");
      opt.value = String(h.number);
      opt.textContent = `${h.number}. ${h.name}`;
      frag.appendChild(opt);
    });
    selectEl.appendChild(frag);
  }

  // ===== تحديث الصوت من سجل محفوظ (صفحة/سورة/حزب) =====
  async function setAudioFromRecord(rec) {
    if (state.currentObjectUrl) {
      URL.revokeObjectURL(state.currentObjectUrl);
      state.currentObjectUrl = null;
    }
    if (rec && rec.blob) {
      state.hasRecording = true;
      state.currentRecMime = rec.mimeType || rec.blob.type || "";
      state.currentObjectUrl = URL.createObjectURL(rec.blob);
      state.audio.src = state.currentObjectUrl;
      el.recordedBadge.classList.remove("hidden");
      el.playBtn.disabled = false;
      el.deleteBtn.disabled = false;
      el.downloadBtn.disabled = false;
    } else {
      state.hasRecording = false;
      state.currentRecMime = null;
      state.audio.removeAttribute("src");
      el.recordedBadge.classList.add("hidden");
      el.playBtn.disabled = true;
      el.deleteBtn.disabled = true;
      el.downloadBtn.disabled = true;
    }
    el.stopBtn.disabled = true;
    el.curTime.textContent = "0:00";
    el.durTime.textContent = "0:00";
    el.seekBar.value = 0;
    setRing(0);
    state.repeatDone = 0;
    updateRepeatInfo();
    setPlayIconState(false);
  }

  // ===== تبديل الوضع (صفحة / سورة / حزب) =====
  function setModeUI(mode) {
    state.mode = mode;
    el.modePageBtn.classList.toggle("active", mode === "page");
    el.modeSurahBtn.classList.toggle("active", mode === "surah");
    el.modeHizbBtn.classList.toggle("active", mode === "hizb");
    el.pagePicker.classList.toggle("hidden", mode !== "page");
    el.surahPicker.classList.toggle("hidden", mode !== "surah");
    el.hizbPicker.classList.toggle("hidden", mode !== "hizb");
    el.surahRange.classList.toggle("hidden", mode !== "surah");
    el.surahRangeControls.classList.toggle("hidden", mode !== "surah");
    el.hizbRange.classList.toggle("hidden", mode !== "hizb");
    el.surahRecordHint.classList.toggle("hidden", mode === "page");
    el.recordBtnText.textContent = mode === "surah" ? "تسجيل السورة كاملة" : mode === "hizb" ? "تسجيل الحزب كاملاً" : "تسجيل الصفحة";
    try { localStorage.setItem("quran-last-mode", mode); } catch (e) { /* تجاهل */ }
  }

  // ===== تحميل صفحة (وضع الصفحة) =====
  // direction: اختياري — يُمرَّر فقط عند التنقّل بالأزرار/السحب بين صفحات مستقلة لتفعيل
  // انتقال سلس بصريًا؛ لا يغيّر أي شيء في منطق تحميل التسجيل أو حالة التشغيل.
  async function loadPage(pageNum, direction) {
    pageNum = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
    stopQueueIfActive();
    stopPlayback();
    stopRecordingIfActive(true);

    state.mode = "page";
    state.currentSurah = null;
    state.currentHizb = null;
    state.currentPage = pageNum;
    state.recordTarget = { type: "page", id: pageNum };

    el.pageInput.value = pageNum;
    el.pageNumberLabel.textContent = "الصفحة " + pageNum;

    try { localStorage.setItem("quran-last-page", String(pageNum)); } catch (e) { /* تجاهل */ }

    loadPageImage(pageNum, direction);

    const rec = await QuranDB.getRecording(pageNum);
    await setAudioFromRecord(rec);
  }

  // ===== تحميل سورة كاملة (وضع السورة) =====
  async function loadSurah(surahNumber) {
    const surah = surahByNumber(surahNumber);
    if (!surah) return;
    stopQueueIfActive();
    stopPlayback();
    stopRecordingIfActive(true);

    state.mode = "surah";
    state.currentSurah = surah;
    state.currentHizb = null;
    state.currentPage = surah.startPage;
    state.recordTarget = { type: "surah", id: surah.number };

    el.surahSelect.value = String(surah.number);
    el.pageNumberLabel.textContent = `سورة ${surah.name} — صفحة ${surah.startPage}`;
    const pageCount = surah.endPage - surah.startPage + 1;
    el.surahRange.textContent = `من صفحة ${surah.startPage} إلى ${surah.endPage} (${pageCount} صفحة)`;
    updateSurahRangeButtonsState();

    try { localStorage.setItem("quran-last-surah", String(surah.number)); } catch (e) { /* تجاهل */ }

    loadPageImage(surah.startPage);

    const rec = await QuranDB.getSurahRecording(surah.number);
    await setAudioFromRecord(rec);
  }

  // ===== تحميل حزب كامل (وضع الحزب) — جديد =====
  async function loadHizb(hizbNumber) {
    const hizb = hizbByNumber(hizbNumber);
    if (!hizb) return;
    stopQueueIfActive();
    stopPlayback();
    stopRecordingIfActive(true);

    state.mode = "hizb";
    state.currentHizb = hizb;
    state.currentSurah = null;
    state.currentPage = hizb.startPage;
    state.recordTarget = { type: "hizb", id: hizb.number };

    el.hizbSelect.value = String(hizb.number);
    el.pageNumberLabel.textContent = `${hizb.name} — صفحة ${hizb.startPage}`;
    const pageCount = hizb.endPage - hizb.startPage + 1;
    const spanTxt = hizb.startSurahName === hizb.endSurahName
      ? `سورة ${hizb.startSurahName}`
      : `من سورة ${hizb.startSurahName} إلى سورة ${hizb.endSurahName}`;
    el.hizbRange.textContent = `${spanTxt} — من صفحة ${hizb.startPage} إلى ${hizb.endPage} (${pageCount} صفحة)`;

    try { localStorage.setItem("quran-last-hizb", String(hizb.number)); } catch (e) { /* تجاهل */ }

    loadPageImage(hizb.startPage);

    const rec = await QuranDB.getHizbRecording(hizb.number);
    await setAudioFromRecord(rec);
  }

  function updateSurahRangeButtonsState() {
    if (!state.currentSurah) return;
    const surah = state.currentSurah;
    el.surahShrinkBtn.disabled = surah.endPage <= surah.startPage;
    el.surahExtendBtn.disabled = surah.endPage >= TOTAL_PAGES;
  }

  function adjustSurahEndPage(delta) {
    if (!state.currentSurah) return;
    const surah = state.currentSurah;
    const newEnd = Math.max(surah.startPage, Math.min(TOTAL_PAGES, surah.endPage + delta));
    if (newEnd === surah.endPage) return;
    surah.endPage = newEnd;
    saveSurahOverride(surah.number, surah.endPage);
    const pageCount = surah.endPage - surah.startPage + 1;
    el.surahRange.textContent = `من صفحة ${surah.startPage} إلى ${surah.endPage} (${pageCount} صفحة)`;
    updateSurahRangeButtonsState();
    showToast(delta > 0 ? "تمت إضافة الصفحة التالية لهذه السورة" : "تم إرجاع آخر صفحة من هذه السورة");
  }

  // تقليب صفحات داخل السورة/الحزب الحالي دون قطع التسجيل أو التشغيل الجاري
  function flipSurahPage(delta) {
    if (!state.currentSurah) return;
    const target = state.currentPage + delta;
    if (target < state.currentSurah.startPage || target > state.currentSurah.endPage) return;
    state.currentPage = target;
    el.pageNumberLabel.textContent = `سورة ${state.currentSurah.name} — صفحة ${target}`;
    loadPageImage(target, delta > 0 ? "next" : "prev");
  }

  function flipHizbPage(delta) {
    if (!state.currentHizb) return;
    const target = state.currentPage + delta;
    if (target < state.currentHizb.startPage || target > state.currentHizb.endPage) return;
    state.currentPage = target;
    el.pageNumberLabel.textContent = `${state.currentHizb.name} — صفحة ${target}`;
    loadPageImage(target, delta > 0 ? "next" : "prev");
  }

  // نقطة تنقّل واحدة مشتركة بين أزرار السابق/التالي وسحبة الإصبع، حتى يبقى سلوكهما متطابقًا
  // تمامًا دائمًا: في وضع السورة/الحزب لا تُلمَس حالة الصوت إطلاقًا (تقليب صورة فقط)،
  // وفي وضع الصفحة تُحمَّل صفحة مستقلة بتسجيلها الخاص (نفس سلوك الأزرار الأصلي).
  function goToAdjacentPage(delta) {
    if (state.queue) return; // لقائمة الاستماع أزرار تنقّل خاصة بها منفصلة تمامًا عن هذه
    if (state.mode === "surah") flipSurahPage(delta);
    else if (state.mode === "hizb") flipHizbPage(delta);
    else loadPage(state.currentPage + delta, delta > 0 ? "next" : "prev");
  }

  // ===== إبقاء الشاشة مضاءة أثناء التسجيل (Wake Lock) =====
  // يعتمد على Screen Wake Lock API القياسي (مدعوم على Android/Chrome وأغلب المتصفحات
  // الحديثة، بما فيها PWA المثبَّتة). عند عدم توفّره، يتحوّل تلقائيًا لبديل عملي:
  // فيديو صامت غير مرئي (1×1) يعمل في حلقة مستمرة — وهي طريقة معروفة تمنع بعض
  // المتصفحات/الأجهزة الأقدم من إطفاء الشاشة تلقائيًا أثناء تشغيل فيديو.
  // يدعم عدّة "أصحاب" في آن واحد (تسجيل صفحة/سورة/حزب + تسجيل إجابة اختبار الحفظ)
  // بحيث لا يُحرَّر القفل فعليًا إلا بعد توقف كل عمليات التسجيل الجارية.
  const WakeLockCtl = (() => {
    const isSupported = "wakeLock" in navigator;
    let sentinel = null;
    let fallbackVideo = null;
    const owners = new Set();

    function createFallbackVideo() {
      const v = document.createElement("video");
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.setAttribute("aria-hidden", "true");
      v.tabIndex = -1;
      Object.assign(v.style, {
        position: "fixed", left: "-9999px", top: "0",
        width: "1px", height: "1px", opacity: "0", pointerEvents: "none",
      });
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 2, 2); }
        if (canvas.captureStream) v.srcObject = canvas.captureStream(2);
      } catch (e) { /* تجاهل — سيبقى العنصر بلا مصدر فقط إن فشل هذا */ }
      document.body.appendChild(v);
      return v;
    }

    async function engageFallback() {
      if (fallbackVideo) return;
      fallbackVideo = createFallbackVideo();
      try { await fallbackVideo.play(); } catch (e) { /* أفضل محاولة ممكنة فقط — لا يوجد بديل أقوى */ }
    }

    function disposeFallback() {
      if (!fallbackVideo) return;
      try { fallbackVideo.pause(); } catch (e) { /* تجاهل */ }
      try { fallbackVideo.remove(); } catch (e) { /* تجاهل */ }
      fallbackVideo = null;
    }

    async function engage() {
      if (owners.size === 0 || sentinel) return;
      let ok = false;
      if (isSupported) {
        try {
          sentinel = await navigator.wakeLock.request("screen");
          sentinel.addEventListener("release", () => { sentinel = null; });
          ok = true;
        } catch (e) {
          sentinel = null; // فشل الطلب (دعم جزئي/سياسة متصفح) — ننتقل للبديل بالأسفل
        }
      }
      if (ok) disposeFallback();
      else await engageFallback();
    }

    async function disengage() {
      if (sentinel) {
        try { await sentinel.release(); } catch (e) { /* تجاهل */ }
        sentinel = null;
      }
      disposeFallback();
    }

    async function acquire(ownerKey) {
      owners.add(ownerKey);
      await engage();
    }

    async function release(ownerKey) {
      owners.delete(ownerKey);
      if (owners.size === 0) await disengage();
    }

    // المتصفح يُحرِّر القفل تلقائيًا كلما اختفت الصفحة (تبديل تطبيق آخر / قفل الهاتف يدويًا) —
    // إن عاد المستخدم للتطبيق وتسجيل ما زال جاريًا فعليًا، نعيد تفعيل القفل فورًا تلقائيًا.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && owners.size > 0) engage();
    });

    return { acquire, release };
  })();

  // ===== التسجيل (صفحة/سورة/حزب) =====

  // جلسة التسجيل تُعتبر "نشطة" سواء كانت تُسجِّل فعليًا الآن أو متوقفة مؤقتًا (لم تُنهَ بعد)
  function isMainRecordingActive() {
    return !!(state.mediaRecorder && (state.mediaRecorder.state === "recording" || state.mediaRecorder.state === "paused"));
  }

  // إجمالي الثواني المسجَّلة فعليًا حتى الآن في الجلسة الحالية (يجمع كل المقاطع بين الإيقافات
  // المؤقتة). أثناء الإيقاف المؤقت تبقى القيمة ثابتة تلقائيًا (لا يُضاف زمن الانتظار).
  function currentRecordedSeconds() {
    if (!state.mediaRecorder) return 0;
    if (state.mediaRecorder.state === "paused") return state.recordElapsedBeforePause;
    return state.recordElapsedBeforePause + (Date.now() - state.recordStartTime) / 1000;
  }

  async function startRecording() {
    if (state.isPlaying) stopPlayback();
    if (state.queue) return; // لا تسجيل أثناء قائمة استماع نشطة

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showToast("تعذّر الوصول إلى الميكروفون");
      return;
    }

    state.stream = stream;
    state.chunks = [];

    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    const mimeType = preferredTypes.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";

    try {
      state.mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      showToast("متصفحك لا يدعم التسجيل الصوتي");
      return;
    }

    const target = { type: state.recordTarget.type, id: state.recordTarget.id };

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
      const duration = state.recordFinalDuration;

      // نجلب سجل النسخ السابقة قبل إضافة هذه النسخة، لمقارنة مدة هذا التسجيل بمعتادها
      let priorHistory = [];
      try { priorHistory = await QuranDB.getHistoryForTarget(target.type, target.id); } catch (e) { /* تجاهل */ }

      if (target.type === "surah") {
        await QuranDB.saveSurahRecording(target.id, blob, duration);
      } else if (target.type === "hizb") {
        const hizb = hizbByNumber(target.id);
        await QuranDB.saveHizbRecording(target.id, blob, duration, hizb ? {
          hizbName: hizb.name, startSurahName: hizb.startSurahName, endSurahName: hizb.endSurahName,
          startPage: hizb.startPage, endPage: hizb.endPage,
        } : null);
      } else {
        await QuranDB.saveRecording(target.id, blob, duration);
      }

      // سجل التقدّم: يُضاف كنسخة جديدة، لا يستبدل أي شيء — لا يؤثر على الحفظ أعلاه إن فشل
      try {
        await QuranDB.saveHistoryEntry({ type: target.type, targetId: target.id, blob, duration, label: targetLabel(target.type, target.id) });
      } catch (e) { /* تجاهل — الحفظ الأساسي أهم ونجح فعلاً */ }

      const anomaly = computeDurationAnomaly(priorHistory, duration);
      if (anomaly.isAnomaly) {
        showToast(`⚠️ هذا التسجيل أطول من المعتاد (${formatTime(duration)} مقابل ${formatTime(anomaly.avgDuration)} عادة) — راجعه في «سجل التقدّم»`);
      } else if (target.type === "surah") {
        showToast("تم حفظ تسجيل السورة كاملة");
      } else if (target.type === "hizb") {
        showToast("تم حفظ تسجيل الحزب كاملاً");
      } else {
        showToast("تم حفظ التسجيل");
      }

      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
      if (target.type === "surah") loadSurah(target.id);
      else if (target.type === "hizb") loadHizb(target.id);
      else loadPage(target.id);
    };

    state.mediaRecorder.start();
    state.recordStartTime = Date.now();
    state.recordElapsedBeforePause = 0; // بداية جلسة تسجيل جديدة: لا وقت متراكم من إيقافات مؤقتة بعد
    WakeLockCtl.acquire("mainRecording"); // إبقاء الشاشة مضاءة طوال مدة التسجيل (يبقى مفعَّلاً أثناء أي إيقاف مؤقت أيضًا)

    el.recordBtn.classList.add("hidden");
    el.pauseRecordBtn.classList.remove("hidden");
    setPauseButtonUI(false);
    el.stopRecordBtn.classList.remove("hidden");
    el.recTimer.classList.remove("hidden");
    el.playBtn.disabled = true;
    el.deleteBtn.disabled = true;
    el.modePageBtn.disabled = true;
    el.modeSurahBtn.disabled = true;
    el.modeHizbBtn.disabled = true;
    el.surahSelect.disabled = true;
    el.hizbSelect.disabled = true;
    el.pageInput.disabled = true;
    el.playlistBtn.disabled = true;

    state.recordTimerHandle = setInterval(() => {
      el.recTimer.textContent = formatTime(currentRecordedSeconds());
    }, 200);
  }

  function stopRecordingIfActive(silent) {
    if (isMainRecordingActive()) {
      state.recordFinalDuration = currentRecordedSeconds(); // يُحسب الآن، قبل أن تصبح حالة المسجّل "inactive"
      if (silent) {
        state.mediaRecorder.onstop = () => {
          state.stream && state.stream.getTracks().forEach((t) => t.stop());
        };
      }
      state.mediaRecorder.stop();
    }
    WakeLockCtl.release("mainRecording"); // يُحرَّر تلقائيًا فقط بعد توقف كل عمليات التسجيل الجارية
    clearInterval(state.recordTimerHandle);
    el.recordBtn.classList.remove("hidden");
    el.pauseRecordBtn.classList.add("hidden");
    setPauseButtonUI(false);
    el.stopRecordBtn.classList.add("hidden");
    el.recTimer.classList.add("hidden");
    el.modePageBtn.disabled = false;
    el.modeSurahBtn.disabled = false;
    el.modeHizbBtn.disabled = false;
    el.surahSelect.disabled = false;
    el.hizbSelect.disabled = false;
    el.pageInput.disabled = false;
    el.playlistBtn.disabled = false;
  }

  function stopRecording() {
    stopRecordingIfActive(false);
  }

  // إيقاف مؤقت للتسجيل الجاري: يحفظ الزمن المسجَّل حتى الآن، ثم يوقف المسجّل مؤقتًا
  // (MediaRecorder.pause) دون إنهاء الجلسة — يبقى كل شيء (الهدف، الشريحة، الميكروفون،
  // Wake Lock) كما هو تمامًا استعدادًا للاستئناف.
  function pauseRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") return;
    if (typeof state.mediaRecorder.pause !== "function") {
      showToast("متصفحك لا يدعم الإيقاف المؤقت للتسجيل");
      return;
    }
    state.recordElapsedBeforePause = currentRecordedSeconds();
    state.mediaRecorder.pause();
    setPauseButtonUI(true);
  }

  // استئناف تسجيل متوقف مؤقتًا: يبدأ مقطعًا جديدًا يُضاف فوق ما تراكم من قبل، فينتج في
  // النهاية ملف صوتي واحد متصل بلا أي فجوة مسموعة لمدة التوقف نفسها.
  function resumeRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state !== "paused") return;
    state.recordStartTime = Date.now();
    state.mediaRecorder.resume();
    setPauseButtonUI(false);
  }

  function togglePauseRecording() {
    if (!state.mediaRecorder) return;
    if (state.mediaRecorder.state === "recording") pauseRecording();
    else if (state.mediaRecorder.state === "paused") resumeRecording();
  }

  function setPauseButtonUI(paused) {
    el.pauseRecordIcon.classList.toggle("is-resume", paused);
    el.pauseRecordBtnText.textContent = paused ? "استئناف التسجيل" : "إيقاف مؤقت";
    el.pauseRecordBtn.setAttribute("aria-label", paused ? "استئناف التسجيل" : "إيقاف التسجيل مؤقتًا");
    el.recPausedBadge.classList.toggle("hidden", !paused);
  }

  // ===== التشغيل =====
  function setPlayIconState(playing) {
    state.isPlaying = playing;
    el.playIcon.classList.toggle("hidden", playing);
    el.pauseIcon.classList.toggle("hidden", !playing);
    el.stopBtn.disabled = !playing && state.audio.currentTime === 0;
  }

  function playAudio() {
    if (!state.hasRecording) return;
    state.audio.playbackRate = state.playbackRate;
    state.audio.play();
    setPlayIconState(true);
    el.stopBtn.disabled = false;
    updateRepeatInfo();
  }

  function pauseAudio() {
    state.audio.pause();
    setPlayIconState(false);
  }

  function stopPlayback() {
    state.audio.pause();
    state.audio.currentTime = 0;
    setPlayIconState(false);
    setRing(0);
    el.curTime.textContent = "0:00";
    el.seekBar.value = 0;
    state.repeatDone = 0;
    updateRepeatInfo();
    el.stopBtn.disabled = true;
  }

  state.audio.addEventListener("loadedmetadata", () => {
    el.durTime.textContent = formatTime(state.audio.duration);
    el.seekBar.max = state.audio.duration || 0;
  });

  state.audio.addEventListener("timeupdate", () => {
    el.curTime.textContent = formatTime(state.audio.currentTime);
    el.seekBar.value = state.audio.currentTime;
    if (state.audio.duration) setRing(state.audio.currentTime / state.audio.duration);
  });

  state.audio.addEventListener("ended", () => {
    state.repeatDone += 1;
    const shouldRepeat = state.repeatTarget === Infinity || state.repeatDone < state.repeatTarget;
    if (shouldRepeat) {
      state.audio.currentTime = 0;
      state.audio.playbackRate = state.playbackRate;
      state.audio.play();
      updateRepeatInfo();
    } else {
      state.repeatDone = 0;
      setPlayIconState(false);
      setRing(0);
      state.audio.currentTime = 0;
      el.seekBar.value = 0;
      el.curTime.textContent = "0:00";
      updateRepeatInfo();
      if (state.queue) {
        const next = state.queue.index + 1;
        if (next < state.queue.items.length) {
          playQueueItem(next);
        } else {
          finishQueue();
        }
      }
    }
  });

  // ===== قائمة الاستماع (playlist) =====
  async function openPlaylistModal() {
    el.playlistModal.classList.remove("hidden");
    el.playlistBody.innerHTML = '<p class="playlist-empty">جارٍ التحميل…</p>';
    try {
      const [pageNums, surahNums, hizbNums] = await Promise.all([
        QuranDB.getAllPageNumbers(),
        QuranDB.getAllSurahNumbers(),
        QuranDB.getAllHizbNumbers(),
      ]);
      pageNums.sort((a, b) => a - b);
      surahNums.sort((a, b) => a - b);
      hizbNums.sort((a, b) => a - b);
      await renderPlaylistBody(pageNums, surahNums, hizbNums);
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.playlistBody, err);
        return;
      }
      el.playlistBody.innerHTML = "";
      const p = document.createElement("p");
      p.className = "playlist-empty";
      p.textContent = "تعذّر فتح قائمة الاستماع: " + ((err && err.message) || "خطأ غير معروف") + " — أعد المحاولة.";
      el.playlistBody.appendChild(p);
    }
  }

  async function renderPlaylistBody(pageNums, surahNums, hizbNums) {
    stopPreview();
    el.playlistBody.innerHTML = "";
    if (pageNums.length === 0 && surahNums.length === 0 && hizbNums.length === 0) {
      const p = document.createElement("p");
      p.className = "playlist-empty";
      p.textContent = "لا توجد تسجيلات محفوظة بعد. سجّل بعض الصفحات أو السور أو الأحزاب أولًا.";
      el.playlistBody.appendChild(p);
      updatePlaylistFooter();
      return;
    }
    if (hizbNums.length) {
      const h = document.createElement("div");
      h.className = "playlist-section-title";
      h.textContent = "أحزاب مسجَّلة كاملة";
      el.playlistBody.appendChild(h);
      hizbNums.forEach((n) => {
        const hizb = hizbByNumber(n);
        el.playlistBody.appendChild(makePlaylistItem("hizb", n, hizb ? hizb.name : `الحزب ${n}`));
      });
    }
    if (surahNums.length) {
      const h = document.createElement("div");
      h.className = "playlist-section-title";
      h.textContent = "سور مسجَّلة كاملة";
      el.playlistBody.appendChild(h);
      surahNums.forEach((n) => {
        const surah = surahByNumber(n);
        el.playlistBody.appendChild(makePlaylistItem("surah", n, `سورة ${surah ? surah.name : n}`));
      });
    }
    if (pageNums.length) {
      const h = document.createElement("div");
      h.className = "playlist-section-title";
      h.textContent = "صفحات مسجَّلة";
      el.playlistBody.appendChild(h);
      pageNums.forEach((n) => {
        el.playlistBody.appendChild(makePlaylistItem("page", n, `الصفحة ${n}`));
      });
    }
  }

  async function refreshPlaylistModal() {
    const [pageNums, surahNums, hizbNums] = await Promise.all([
      QuranDB.getAllPageNumbers(), QuranDB.getAllSurahNumbers(), QuranDB.getAllHizbNumbers(),
    ]);
    pageNums.sort((a, b) => a - b); surahNums.sort((a, b) => a - b); hizbNums.sort((a, b) => a - b);
    await renderPlaylistBody(pageNums, surahNums, hizbNums);
  }

  function selectionOrderOf(type, id) {
    const idx = state.playlistSelection.findIndex((it) => it.type === type && it.id === id);
    return idx === -1 ? null : idx + 1;
  }

  // ----- معاينة صوتية مباشرة لعنصر واحد في قائمة الاستماع -----
  function stopPreview() {
    state.preview.audio.pause();
    state.preview.audio.currentTime = 0;
    if (state.preview.url) { URL.revokeObjectURL(state.preview.url); state.preview.url = null; }
    const prevType = state.preview.type, prevId = state.preview.id;
    state.preview.type = null; state.preview.id = null;
    if (prevType != null) updatePreviewButtonUI(prevType, prevId, false);
  }

  function updatePreviewButtonUI(type, id, playing) {
    const row = el.playlistBody.querySelector(`.playlist-item-row[data-ptype="${type}"][data-pid="${id}"]`);
    if (!row) return;
    const playBtn = row.querySelector(".pl-play");
    if (playBtn) playBtn.textContent = playing ? "⏸" : "▶";
  }

  async function togglePreview(type, id) {
    const isSameActive = state.preview.type === type && state.preview.id === id;
    if (isSameActive && !state.preview.audio.paused) {
      state.preview.audio.pause();
      updatePreviewButtonUI(type, id, false);
      return;
    }
    if (isSameActive && state.preview.audio.paused && state.preview.audio.src) {
      state.preview.audio.play();
      updatePreviewButtonUI(type, id, true);
      return;
    }
    // تشغيل عنصر مختلف: أوقف أي معاينة سابقة أولًا
    stopPreview();
    const rec = await getRecordByType(type, id);
    if (!rec || !rec.blob) { showToast("لا يوجد تسجيل لتشغيله"); return; }
    const url = URL.createObjectURL(rec.blob);
    state.preview.type = type; state.preview.id = id; state.preview.url = url;
    state.preview.audio.src = url;
    state.preview.audio.currentTime = 0;
    state.preview.audio.play();
    updatePreviewButtonUI(type, id, true);
  }

  function replayPreview(type, id) {
    if (state.preview.type === type && state.preview.id === id) {
      state.preview.audio.currentTime = 0;
      state.preview.audio.play();
      updatePreviewButtonUI(type, id, true);
    } else {
      togglePreview(type, id);
    }
  }

  state.preview.audio.addEventListener("ended", () => {
    const t = state.preview.type, i = state.preview.id;
    if (t != null) updatePreviewButtonUI(t, i, false);
  });

  function goToItemForRerecord(type, id) {
    el.playlistModal.classList.add("hidden");
    if (type === "surah") { setModeUI("surah"); loadSurah(id); }
    else if (type === "hizb") { setModeUI("hizb"); loadHizb(id); }
    else { setModeUI("page"); loadPage(id); }
    showToast("جاهز لإعادة التسجيل — اضغط زر التسجيل عند الاستعداد");
  }

  async function deletePlaylistItem(type, id, label) {
    const ok = await showConfirm(`هل تريد حذف هذا التسجيل نهائيًا؟\n(${label})`);
    if (!ok) return;
    if (state.preview.type === type && state.preview.id === id) stopPreview();
    await deleteRecordByType(type, id);
    state.playlistSelection = state.playlistSelection.filter((it) => !(it.type === type && it.id === id));
    showToast("تم حذف التسجيل");
    await refreshPlaylistModal();
    updatePlaylistFooter();
    // إن كان المستخدم يعرض حاليًا نفس هذا العنصر في الشاشة الرئيسية، حدّث حالته
    if (state.recordTarget.type === type && state.recordTarget.id === id) {
      if (type === "surah") loadSurah(id); else if (type === "hizb") loadHizb(id); else loadPage(id);
    }
  }

  function makePlaylistItem(type, id, label) {
    const wrap = document.createElement("div");
    wrap.className = "playlist-item-row";
    wrap.dataset.ptype = type;
    wrap.dataset.pid = String(id);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "playlist-item";
    row.dataset.type = type;
    row.dataset.id = String(id);
    const order = selectionOrderOf(type, id);
    row.classList.toggle("selected", !!order);
    row.innerHTML =
      `<span class="playlist-item-badge${order ? " active" : ""}">${order || ""}</span>` +
      `<span class="playlist-item-label">${label}</span>`;
    row.addEventListener("click", () => togglePlaylistSelection(type, id, label));

    const controls = document.createElement("div");
    controls.className = "playlist-item-controls";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "pl-ctrl-btn pl-play";
    playBtn.setAttribute("aria-label", `تشغيل ${label}`);
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePreview(type, id); });

    const repeatBtn = document.createElement("button");
    repeatBtn.type = "button";
    repeatBtn.className = "pl-ctrl-btn";
    repeatBtn.setAttribute("aria-label", `إعادة ${label}`);
    repeatBtn.textContent = "🔁";
    repeatBtn.addEventListener("click", (e) => { e.stopPropagation(); replayPreview(type, id); });

    const rerecordBtn = document.createElement("button");
    rerecordBtn.type = "button";
    rerecordBtn.className = "pl-ctrl-btn";
    rerecordBtn.setAttribute("aria-label", `إعادة تسجيل ${label}`);
    rerecordBtn.textContent = "✏️";
    rerecordBtn.addEventListener("click", (e) => { e.stopPropagation(); goToItemForRerecord(type, id); });

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "pl-ctrl-btn";
    dlBtn.setAttribute("aria-label", `تحميل/إرسال ${label}`);
    dlBtn.innerHTML = downloadIconSVG();
    dlBtn.addEventListener("click", (e) => { e.stopPropagation(); downloadRecordingFor(type, id, label); });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "pl-ctrl-btn pl-delete";
    delBtn.setAttribute("aria-label", `حذف ${label}`);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deletePlaylistItem(type, id, label); });

    controls.append(playBtn, repeatBtn, rerecordBtn, dlBtn, delBtn);
    wrap.appendChild(row);
    wrap.appendChild(controls);
    return wrap;
  }

  function togglePlaylistSelection(type, id, label) {
    const idx = state.playlistSelection.findIndex((it) => it.type === type && it.id === id);
    if (idx === -1) state.playlistSelection.push({ type, id, label });
    else state.playlistSelection.splice(idx, 1);
    refreshPlaylistBadges();
    updatePlaylistFooter();
  }

  function refreshPlaylistBadges() {
    el.playlistBody.querySelectorAll(".playlist-item").forEach((row) => {
      const type = row.dataset.type;
      const id = parseInt(row.dataset.id, 10);
      const order = selectionOrderOf(type, id);
      const badge = row.querySelector(".playlist-item-badge");
      badge.textContent = order || "";
      badge.classList.toggle("active", !!order);
      row.classList.toggle("selected", !!order);
    });
  }

  function updatePlaylistFooter() {
    const n = state.playlistSelection.length;
    el.startPlaylistBtn.disabled = n === 0;
    el.startPlaylistBtn.textContent = n ? `تشغيل القائمة (${n})` : "تشغيل القائمة";
  }

  // ===== محرك تشغيل قائمة الاستماع =====
  function stopQueueIfActive() {
    if (!state.queue) return;
    state.queue = null;
    el.queueBar.classList.add("hidden");
    el.pageNav.classList.remove("hidden");
    el.modeTabs.classList.remove("hidden");
    el.recordRow.classList.remove("hidden");
    el.playlistBtn.classList.remove("hidden");
  }

  async function startQueue(items) {
    if (!items || items.length === 0) return;
    stopPlayback();
    stopRecordingIfActive(true);
    state.queue = { items, index: 0 };
    el.pageNav.classList.add("hidden");
    el.modeTabs.classList.add("hidden");
    el.recordRow.classList.add("hidden");
    el.surahRecordHint.classList.add("hidden");
    el.surahRange.classList.add("hidden");
    el.surahRangeControls.classList.add("hidden");
    el.hizbRange.classList.add("hidden");
    el.playlistBtn.classList.add("hidden");
    el.queueBar.classList.remove("hidden");
    await playQueueItem(0);
  }

  async function playQueueItem(i) {
    if (!state.queue) return;
    if (i < 0 || i >= state.queue.items.length) return;
    state.queue.index = i;
    const item = state.queue.items[i];
    el.queuePosition.textContent = `المقطع ${i + 1} من ${state.queue.items.length}`;
    el.queueLabel.textContent = item.label;
    el.queuePrevBtn.disabled = i === 0;
    el.queueNextBtn.disabled = i === state.queue.items.length - 1;

    let rec, imagePage;
    if (item.type === "surah") {
      const surah = surahByNumber(item.id);
      imagePage = surah ? surah.startPage : null;
      rec = await QuranDB.getSurahRecording(item.id);
    } else if (item.type === "hizb") {
      const hizb = hizbByNumber(item.id);
      imagePage = hizb ? hizb.startPage : null;
      rec = await QuranDB.getHizbRecording(item.id);
    } else {
      imagePage = item.id;
      rec = await QuranDB.getRecording(item.id);
    }
    el.pageNumberLabel.textContent = item.label;
    if (imagePage) {
      state.currentPage = imagePage;
      loadPageImage(imagePage);
    }
    await setAudioFromRecord(rec);

    if (rec && rec.blob) {
      playAudio();
    } else {
      showToast(`لا يوجد تسجيل لـ ${item.label} — سيتم تخطّيه`);
      const next = i + 1;
      if (state.queue && next < state.queue.items.length) {
        setTimeout(() => { if (state.queue) playQueueItem(next); }, 700);
      } else {
        finishQueue();
      }
    }
  }

  function currentLoadForMode() {
    if (state.mode === "surah" && state.currentSurah) return loadSurah(state.currentSurah.number);
    if (state.mode === "hizb" && state.currentHizb) return loadHizb(state.currentHizb.number);
    return loadPage(state.currentPage);
  }

  function finishQueue() {
    showToast("انتهت قائمة الاستماع");
    stopQueueIfActive();
    currentLoadForMode();
  }

  function exitQueueToNormalView() {
    stopQueueIfActive();
    currentLoadForMode();
  }

  // =========================================================================
  // ===== اختبار حفظ الأحزاب (جديد بالكامل) =====
  // =========================================================================

  function populateHizbTestSelect() {
    populateHizbSelect(el.hizbTestSelect);
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // بنك أسئلة كل حزب يُحمَّل عند الحاجة فقط عبر إضافة وسم <script> ديناميكيًا —
  // وليس عبر fetch()، لأن fetch() لملفات محلية يُمنع أو يفشل في أكثر المتصفحات
  // إن كان التطبيق مفتوحًا مباشرة كملف (file://) بدل خادم ويب، بينما وسوم
  // <script> تعمل في الحالتين. النتائج تُخزَّن مؤقتًا في الذاكرة بعد أول تحميل.
  const hizbPoolCache = {};
  const hizbPoolInFlight = {};
  window.__onHizbPoolLoaded = function (hizbNum, data) {
    hizbPoolCache[hizbNum] = data;
  };

  function fetchHizbPool(hizbNum) {
    if (hizbPoolCache[hizbNum]) return Promise.resolve(hizbPoolCache[hizbNum]);
    if (hizbPoolInFlight[hizbNum]) return hizbPoolInFlight[hizbNum];

    const promise = new Promise((resolve, reject) => {
      const src = `js/quiz-pool/hizb-${String(hizbNum).padStart(2, "0")}.js`;
      const script = document.createElement("script");
      script.src = src;
      const cleanup = () => {
        clearTimeout(timeoutHandle);
        script.remove();
      };
      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`تعذّر تحميل بيانات اختبار الحزب ${hizbNum} (انتهت المهلة) — تأكّد من فتح التطبيق عبر خادم أو رابط ويب وليس بالنقر المباشر على ملف index.html، ثم أعد المحاولة`));
      }, 12000);
      script.onload = () => {
        cleanup();
        if (hizbPoolCache[hizbNum]) resolve(hizbPoolCache[hizbNum]);
        else reject(new Error(`تعذّر قراءة بيانات اختبار الحزب ${hizbNum} — أعد المحاولة`));
      };
      script.onerror = () => {
        cleanup();
        reject(new Error(`تعذّر تحميل بيانات اختبار الحزب ${hizbNum} — تأكّد من فتح التطبيق عبر خادم أو رابط ويب وليس بالنقر المباشر على ملف index.html`));
      };
      document.head.appendChild(script);
    });
    hizbPoolInFlight[hizbNum] = promise;
    promise.finally(() => { delete hizbPoolInFlight[hizbNum]; }).catch(() => { /* المعالجة الفعلية تتم على الوعد الأصلي المُرجَع أدناه */ });
    return promise;
  }

  // يبني مجموعة أسئلة جديدة (حتى 30) لحزب معيّن، موزّعة على بداية/وسط/نهاية
  // صفحاته، ولا يكرر أسئلة استُخدمت من قبل إلا بعد استنفاد كل الأسئلة الممكنة.
  async function buildAttemptQuestions(hizbNum) {
    const pool = await fetchHizbPool(hizbNum);
    if (!pool || pool.length === 0) return [];
    let used = await QuranDB.getUsedQuestionIds(hizbNum);
    let available = pool.filter((q) => !used.includes(q.qid));

    const target = Math.min(QUESTIONS_PER_ATTEMPT, pool.length);
    if (available.length < target) {
      // استُنفدت كل الأسئلة الممكنة لهذا الحزب — أعِد التدوير من جديد
      await QuranDB.resetUsedQuestionIds(hizbNum);
      used = [];
      available = pool.slice();
    }

    // وزّع الاختيار على الأثلاث الثلاثة (بداية/وسط/نهاية الصفحات)
    const buckets = { 0: [], 1: [], 2: [] };
    available.forEach((q) => buckets[q.third].push(q));
    Object.values(buckets).forEach(shuffleInPlace);
    const chosen = [];
    const perBucket = Math.max(1, Math.floor(target / 3));
    [0, 1, 2].forEach((b) => chosen.push(...buckets[b].slice(0, perBucket)));
    if (chosen.length < target) {
      const chosenIds = new Set(chosen.map((q) => q.qid));
      const rest = shuffleInPlace(available.filter((q) => !chosenIds.has(q.qid)));
      chosen.push(...rest.slice(0, target - chosen.length));
    }
    chosen.sort((a, b) => (a.page - b.page) || (a.ayah - b.ayah));
    return chosen.slice(0, target);
  }

  async function startHizbTestAttempt() {
    const hizbNum = parseInt(el.hizbTestSelect.value, 10);
    const hizb = hizbByNumber(hizbNum);
    if (!hizb) return;
    el.hizbTestStartBtn.disabled = true;
    const originalLabel = el.hizbTestStartBtn.textContent;
    el.hizbTestStartBtn.textContent = "جارٍ التحميل…";
    el.hizbTestCoverage.textContent = "جارٍ تحميل أسئلة هذا الحزب…";
    try {
      const questions = await buildAttemptQuestions(hizbNum);
      if (questions.length === 0) {
        el.hizbTestCoverage.textContent = "لا توجد أسئلة كافية لهذا الحزب";
        return;
      }
      state.hizbTest = {
        hizb: hizbNum,
        attemptId: "a" + Date.now(),
        questions,
        index: 0,
        answers: {},
      };
      el.hizbTestSetup.classList.add("hidden");
      el.hizbTestReview.classList.add("hidden");
      el.hizbTestRun.classList.remove("hidden");
      renderHizbTestQuestion();
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.hizbTestSetup, err);
        return;
      }
      el.hizbTestCoverage.textContent = (err && err.message) || "تعذّر بدء الاختبار — حاول مجددًا";
      showToast((err && err.message) || "تعذّر بدء الاختبار — حاول مجددًا");
    } finally {
      el.hizbTestStartBtn.disabled = false;
      el.hizbTestStartBtn.textContent = originalLabel;
    }
  }

  function questionMetaText(q) {
    return `صفحة ${q.page} — سورة ${q.surahName} — آية ${q.ayah}`;
  }

  function renderHizbTestQuestion() {
    const t = state.hizbTest;
    const q = t.questions[t.index];
    if (!q) { finishHizbTest(); return; }
    el.hizbTestProgressText.textContent = `السؤال ${t.index + 1} من ${t.questions.length}`;
    el.hizbTestProgressFill.style.width = `${((t.index) / t.questions.length) * 100}%`;
    el.hizbTestQMeta.textContent = questionMetaText(q);
    el.hizbTestPrefixText.textContent = q.prefix;
    el.hizbAnswerRecordBtn.classList.remove("hidden");
    el.hizbAnswerStopBtn.classList.add("hidden");
    el.hizbAnswerTimer.classList.add("hidden");
    el.hizbAnswerTimer.textContent = "0:00";
    const hasAnswer = !!t.answers[q.qid];
    el.hizbTestNextBtn.disabled = !hasAnswer;
    el.hizbTestNextBtn.textContent = t.index === t.questions.length - 1 ? "إنهاء وعرض النتائج" : "السؤال التالي";
    el.hizbAnswerRecordBtn.querySelector(".btn-text").textContent = hasAnswer ? "إعادة تسجيل الإجابة" : "ابدأ التسجيل";
  }

  async function startHizbAnswerRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      showToast("تعذّر الوصول إلى الميكروفون");
      return;
    }
    state.testStream = stream;
    state.testChunks = [];
    const preferredTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    const mimeType = preferredTypes.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
    try {
      state.testMediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      showToast("متصفحك لا يدعم التسجيل الصوتي");
      return;
    }
    state.testMediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.testChunks.push(e.data); };
    state.testMediaRecorder.onstop = () => {
      const blob = new Blob(state.testChunks, { type: state.testMediaRecorder.mimeType || "audio/webm" });
      const duration = (Date.now() - state.testRecordStart) / 1000;
      const t = state.hizbTest;
      const q = t.questions[t.index];
      if (q) t.answers[q.qid] = { blob, duration, mimeType: blob.type };
      state.testStream && state.testStream.getTracks().forEach((tr) => tr.stop());
      state.testStream = null;
      renderHizbTestQuestion();
    };
    state.testMediaRecorder.start();
    state.testRecordStart = Date.now();
    WakeLockCtl.acquire("hizbTestRecording"); // إبقاء الشاشة مضاءة أثناء تسجيل إجابة الاختبار أيضًا
    el.hizbAnswerRecordBtn.classList.add("hidden");
    el.hizbAnswerStopBtn.classList.remove("hidden");
    el.hizbAnswerTimer.classList.remove("hidden");
    el.hizbTestSkipBtn.disabled = true;
    state.testRecordTimerHandle = setInterval(() => {
      el.hizbAnswerTimer.textContent = formatTime((Date.now() - state.testRecordStart) / 1000);
    }, 200);
  }

  function stopHizbAnswerRecording() {
    if (state.testMediaRecorder && state.testMediaRecorder.state === "recording") {
      state.testMediaRecorder.stop();
    }
    WakeLockCtl.release("hizbTestRecording");
    clearInterval(state.testRecordTimerHandle);
    el.hizbTestSkipBtn.disabled = false;
  }

  function goToNextHizbTestQuestion() {
    const t = state.hizbTest;
    if (t.index < t.questions.length - 1) {
      t.index += 1;
      renderHizbTestQuestion();
    } else {
      finishHizbTest();
    }
  }

  function skipHizbTestQuestion() {
    goToNextHizbTestQuestion();
  }

  async function finishHizbTest() {
    const t = state.hizbTest;
    const savedQids = [];
    let qNum = 1;
    for (const q of t.questions) {
      const ans = t.answers[q.qid];
      if (ans) {
        await QuranDB.saveTestRecording({
          hizb: t.hizb, attemptId: t.attemptId, qid: q.qid, questionNumber: qNum,
          page: q.page, surah: q.surah, surahName: q.surahName, ayah: q.ayah, prefix: q.prefix,
          type: q.type, fromPage: q.fromPage, toPage: q.toPage, nextSurahName: q.nextSurahName,
          blob: ans.blob, duration: ans.duration,
        });
        savedQids.push(q.qid);
      }
      qNum++;
    }
    if (savedQids.length) await QuranDB.addUsedQuestionIds(t.hizb, savedQids);

    el.hizbTestRun.classList.add("hidden");
    el.hizbTestReview.classList.remove("hidden");
    await renderHizbTestReview(t.hizb, t.attemptId);
  }

  async function renderHizbTestReview(hizbNum, attemptId) {
    const recs = await QuranDB.getTestRecordingsForAttempt(hizbNum, attemptId);
    el.hizbTestReviewList.innerHTML = "";
    if (recs.length === 0) {
      const p = document.createElement("p");
      p.className = "playlist-empty";
      p.textContent = "لم تُسجَّل أي إجابات في هذا الاختبار.";
      el.hizbTestReviewList.appendChild(p);
      return;
    }
    recs.forEach((r) => {
      const card = document.createElement("div");
      card.className = "review-item";
      const url = URL.createObjectURL(r.blob);
      const metaLine = r.type === "surah" ? `نقطة وصل — نهاية سورة ${r.surahName} ← بداية سورة ${r.nextSurahName}`
        : r.type === "page" ? `نقطة وصل — نهاية صفحة ${r.fromPage} ← بداية صفحة ${r.toPage} (سورة ${r.surahName})`
        : `صفحة ${r.page} — سورة ${r.surahName} — آية ${r.ayah}`;
      const pageForMarks = (r.type === "page" || r.type === "surah") ? r.fromPage : r.page;
      card.innerHTML = `
        <div class="review-item-head">
          <span class="review-qnum">سؤال ${r.questionNumber}</span>
          <span class="review-meta">${metaLine}</span>
        </div>
        <p class="review-prefix" dir="rtl">${r.prefix}</p>
        <audio controls src="${url}" class="review-audio"></audio>
        <button type="button" class="review-mark-toggle-btn">📄 عرض الصفحة وتحديد الأخطاء</button>
        <div class="review-mark-panel hidden">
          <div class="page-status">
            <span class="badge error-count-badge hidden">عدد الأخطاء الحالية: 0</span>
          </div>
          <div class="review-page-image-wrap">
            <img class="review-page-image" src="${pageImageSrc(pageForMarks)}" alt="صورة صفحة ${pageForMarks}">
            <div class="error-marks-layer"></div>
          </div>
          <div class="error-mark-controls">
            <button type="button" class="mark-mode-btn" aria-pressed="false">
              <span aria-hidden="true">⭕</span><span>وضع علامة خطأ</span>
            </button>
            <p class="mark-mode-hint hidden">الوضع مفعَّل — اضغط على أي مكان في الصورة لوضع علامة، أو اضغط على علامة موجودة لحذفها.</p>
          </div>
        </div>
        <button type="button" class="pl-ctrl-btn pl-delete review-del-btn" aria-label="حذف هذا التسجيل">🗑 حذف هذا التسجيل</button>
      `;
      card.querySelector(".review-del-btn").addEventListener("click", async () => {
        const ok = await showConfirm("هل تريد حذف هذا التسجيل نهائيًا؟");
        if (!ok) return;
        await QuranDB.deleteTestRecording(r.id);
        URL.revokeObjectURL(url);
        renderHizbTestReview(hizbNum, attemptId);
      });

      // لوحة تحديد الأخطاء لهذه البطاقة تحديدًا — تُنشَأ عند أول ظهور فقط
      // (وليس لكل الأسئلة دفعة واحدة) لتبقى شاشة المراجعة خفيفة افتراضيًا
      const panel = card.querySelector(".review-mark-panel");
      const toggleBtn = card.querySelector(".review-mark-toggle-btn");
      let controller = null;
      toggleBtn.addEventListener("click", () => {
        const willShow = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !willShow);
        toggleBtn.textContent = willShow ? "📄 إخفاء الصفحة" : "📄 عرض الصفحة وتحديد الأخطاء";
        if (willShow && !controller) {
          controller = createMarkController({
            wrapEl: panel.querySelector(".review-page-image-wrap"),
            imgEl: panel.querySelector(".review-page-image"),
            layerEl: panel.querySelector(".error-marks-layer"),
            badgeEl: panel.querySelector(".error-count-badge"),
            toggleBtn: panel.querySelector(".mark-mode-btn"),
            hintEl: panel.querySelector(".mark-mode-hint"),
            getPage: () => pageForMarks,
          });
          controller.load();
        } else if (willShow && controller) {
          controller.reposition();
        }
      });

      el.hizbTestReviewList.appendChild(card);
    });
  }

  function endHizbTestEarly() {
    const t = state.hizbTest;
    if (Object.keys(t.answers).length === 0) {
      showToast("لم تُسجَّل أي إجابة بعد");
      return;
    }
    finishHizbTest();
  }

  function stopHizbTestRecordingIfActive() {
    if (state.testMediaRecorder && state.testMediaRecorder.state === "recording") {
      state.testMediaRecorder.onstop = () => {
        state.testStream && state.testStream.getTracks().forEach((t) => t.stop());
      };
      state.testMediaRecorder.stop();
    }
    WakeLockCtl.release("hizbTestRecording");
    clearInterval(state.testRecordTimerHandle);
  }

  function openHizbTestModal() {
    el.hizbTestSetup.classList.remove("hidden");
    el.hizbTestRun.classList.add("hidden");
    el.hizbTestReview.classList.add("hidden");
    el.hizbTestModal.classList.remove("hidden");
    const preselect = state.currentHizb ? state.currentHizb.number
      : (hizbForPage(state.currentPage) ? hizbForPage(state.currentPage).number : 1);
    el.hizbTestSelect.value = String(preselect);
    updateHizbTestCoverage();
  }

  async function updateHizbTestCoverage() {
    const hizbNum = parseInt(el.hizbTestSelect.value, 10);
    el.hizbTestCoverage.textContent = "جارٍ التحميل…";
    try {
      const pool = await fetchHizbPool(hizbNum);
      const used = await QuranDB.getUsedQuestionIds(hizbNum);
      const remaining = pool.filter((q) => !used.includes(q.qid)).length;
      el.hizbTestCoverage.textContent = pool.length
        ? `عدد الأسئلة الممكنة لهذا الحزب: ${pool.length} — المتبقي غير المستخدم حاليًا: ${remaining}`
        : "";
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.hizbTestSetup, err);
        return;
      }
      el.hizbTestCoverage.textContent = (err && err.message) || "تعذّر تحميل بيانات هذا الحزب";
    }
  }

  // =========================================================================
  // ===== حالة الحفظ (ثابت / يحتاج مراجعة) + تذكير المراجعة اليومي (جديد) =====
  // =========================================================================

  // يحسب حالة كل حزب من الستين اعتمادًا على تاريخ آخر نشاط حقيقي عليه
  // (تسجيل حزب كامل، أو أي إجابة في اختبار حفظ) — بلا أي تخمين أو تقييم يدوي.
  async function computeHizbReviewStatus() {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const nums = Array.from({ length: 60 }, (_, i) => i + 1);
    const entries = await Promise.all(nums.map(async (h) => {
      let lastTs = null;
      const [rec, tests] = await Promise.all([
        QuranDB.getHizbRecording(h).catch(() => null),
        QuranDB.getAllTestRecordingsForHizb(h).catch(() => []),
      ]);
      if (rec && rec.createdAt) lastTs = rec.createdAt;
      tests.forEach((t) => { if (t.createdAt && (!lastTs || t.createdAt > lastTs)) lastTs = t.createdAt; });
      if (lastTs == null) return [h, { level: "none", lastTs: null, daysSince: null }];
      const daysSince = Math.floor((now - lastTs) / DAY);
      const level = daysSince <= 14 ? "solid" : daysSince <= 30 ? "soon" : "needs";
      return [h, { level, lastTs, daysSince }];
    }));
    return Object.fromEntries(entries);
  }

  const STATUS_LABELS = { solid: "ثابت", soon: "يحتاج مراجعة قريبًا", needs: "يحتاج مراجعة", none: "لم يُسجَّل بعد" };

  function renderStatusDashboard(statusMap) {
    const counts = { solid: 0, soon: 0, needs: 0, none: 0 };
    for (let h = 1; h <= 60; h++) counts[statusMap[h].level]++;
    el.statusSummaryRow.innerHTML = "";
    ["solid", "soon", "needs", "none"].forEach((level) => {
      const chip = document.createElement("span");
      chip.className = `status-chip c-${level}`;
      chip.textContent = `${counts[level]} ${STATUS_LABELS[level]}`;
      el.statusSummaryRow.appendChild(chip);
    });

    el.statusGrid.innerHTML = "";
    for (let h = 1; h <= 60; h++) {
      const s = statusMap[h];
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `status-cell c-${s.level}`;
      cell.textContent = String(h);
      cell.title = s.level === "none" ? "لم يُسجَّل بعد" : `${STATUS_LABELS[s.level]} — آخر نشاط قبل ${s.daysSince} يوم`;
      cell.addEventListener("click", () => {
        el.reminderModal.classList.add("hidden");
        setModeUI("hizb");
        loadHizb(h);
      });
      el.statusGrid.appendChild(cell);
    }
  }

  async function openReminderModal() {
    el.reminderModal.classList.remove("hidden");
    el.statusSummaryRow.innerHTML = '<span class="status-chip">جارٍ التحميل…</span>';
    el.statusGrid.innerHTML = "";
    try {
      const statusMap = await computeHizbReviewStatus();
      renderStatusDashboard(statusMap);
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.reminderBody, err);
        return;
      }
      el.statusSummaryRow.innerHTML = '<span class="status-chip">تعذّر تحميل حالة الحفظ</span>';
    }
  }

  // ميزة التذكير اليومي بالإشعارات أُلغيت. هذا التنظيف لمرة واحدة يمسح أي حالة
  // تذكير كانت محفوظة من نسخة سابقة من التطبيق (تفعيل/وقت/آخر إطلاق) حتى لا
  // يبقى أي إشعار معلَّق لمن كان قد فعّلها سابقًا.
  function clearLegacyReminderState() {
    try {
      localStorage.removeItem("quran-reminder-enabled");
      localStorage.removeItem("quran-reminder-time");
      localStorage.removeItem("quran-reminder-last-fired");
    } catch (e) { /* تجاهل */ }
  }
  clearLegacyReminderState();

  // =========================================================================
  // ===== سجل التقدّم الصوتي: أرشيف كل نسخ التسجيل + كشف "أطول من المعتاد" =====
  // =========================================================================

  function targetLabel(type, id) {
    if (type === "surah") { const s = surahByNumber(id); return s ? `سورة ${s.name}` : `سورة ${id}`; }
    if (type === "hizb") { const h = hizbByNumber(id); return h ? h.name : `الحزب ${id}`; }
    return `الصفحة ${id}`;
  }

  // مقارنة بسيطة بلا أي ذكاء اصطناعي: هل هذا التسجيل أطول بشكل ملحوظ من
  // متوسط النسخ السابقة لنفس الهدف؟ فرق نسبي كبير غالبًا يكشف تلعثمًا أو تكرارًا.
  function computeDurationAnomaly(priorHistory, latestDuration) {
    const durations = (priorHistory || []).map((h) => h.duration).filter((d) => d > 0);
    if (durations.length < 2) return { isAnomaly: false, avgDuration: null };
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const diff = latestDuration - avg;
    const isAnomaly = avg > 0 && diff / avg > 0.35 && diff > 20;
    return { isAnomaly, avgDuration: avg };
  }

  function stopHistoryPreview() {
    state.historyPreview.audio.pause();
    state.historyPreview.audio.currentTime = 0;
    if (state.historyPreview.url) { URL.revokeObjectURL(state.historyPreview.url); state.historyPreview.url = null; }
    const prevBtn = state.historyPreview.btn;
    state.historyPreview.entryId = null;
    state.historyPreview.btn = null;
    if (prevBtn) prevBtn.textContent = "▶";
  }

  function toggleHistoryPreview(entry, btnEl) {
    const isSame = state.historyPreview.entryId === entry.id;
    if (isSame && !state.historyPreview.audio.paused) {
      state.historyPreview.audio.pause();
      btnEl.textContent = "▶";
      return;
    }
    if (isSame && state.historyPreview.audio.paused && state.historyPreview.audio.src) {
      state.historyPreview.audio.play();
      btnEl.textContent = "⏸";
      return;
    }
    stopHistoryPreview();
    const url = URL.createObjectURL(entry.blob);
    state.historyPreview.entryId = entry.id;
    state.historyPreview.btn = btnEl;
    state.historyPreview.url = url;
    state.historyPreview.audio.src = url;
    state.historyPreview.audio.currentTime = 0;
    state.historyPreview.audio.play();
    btnEl.textContent = "⏸";
  }
  state.historyPreview.audio.addEventListener("ended", () => {
    if (state.historyPreview.btn) state.historyPreview.btn.textContent = "▶";
    state.historyPreview.entryId = null;
    state.historyPreview.btn = null;
  });

  // يشغّل أقدم نسخة كاملة، ثم أحدث نسخة تلقائيًا بعدها مباشرة — لتسمع الفرق بأذنك
  function compareOldestNewest(history) {
    if (!history || history.length < 2) return;
    stopHistoryPreview();
    const oldest = history[0];
    const newest = history[history.length - 1];
    showToast("▶ يشغّل الأقدم أولاً، ثم الأحدث تلقائيًا بعده");
    const urlOld = URL.createObjectURL(oldest.blob);
    state.historyPreview.url = urlOld;
    state.historyPreview.audio.src = urlOld;
    state.historyPreview.audio.currentTime = 0;
    state.historyPreview.audio.addEventListener("ended", () => {
      URL.revokeObjectURL(urlOld);
      const urlNew = URL.createObjectURL(newest.blob);
      state.historyPreview.url = urlNew;
      state.historyPreview.audio.src = urlNew;
      state.historyPreview.audio.currentTime = 0;
      state.historyPreview.audio.play();
    }, { once: true });
    state.historyPreview.audio.play();
  }

  function renderProgressLog(history, type, id) {
    stopHistoryPreview();
    el.progressLogList.innerHTML = "";
    if (history.length === 0) {
      el.progressLogCompareRow.classList.add("hidden");
      el.progressLogList.innerHTML = '<p class="playlist-empty">لا يوجد سجل بعد — كل تسجيل تحفظه من الآن يُضاف هنا تلقائيًا، دون حذف القديم.</p>';
      return;
    }
    el.progressLogCompareRow.classList.toggle("hidden", history.length < 2);
    const durations = history.map((h) => h.duration).filter((d) => d > 0);
    const avg = durations.length >= 2 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

    history.slice().reverse().forEach((entry, idxFromEnd) => {
      const originalIndex = history.length - 1 - idxFromEnd;
      const isLatest = originalIndex === history.length - 1;
      const isAnomalous = avg != null && (entry.duration - avg) / avg > 0.35 && (entry.duration - avg) > 20;
      const dateStr = formatArabicDate(entry.createdAt);

      const row = document.createElement("div");
      row.className = "progress-log-item";
      const info = document.createElement("div");
      info.className = "progress-log-item-info";
      info.innerHTML =
        `<span class="progress-log-num">#${originalIndex + 1}${isLatest ? " (الأحدث)" : ""}</span>` +
        `<span class="progress-log-date">${dateStr}</span>` +
        `<span class="progress-log-duration">${formatTime(entry.duration)}</span>` +
        (isAnomalous ? `<span class="progress-log-flag">⚠️ أطول من المعتاد</span>` : "");

      const controls = document.createElement("div");
      controls.className = "progress-log-item-controls";
      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "pl-ctrl-btn pl-play";
      playBtn.setAttribute("aria-label", `تشغيل النسخة رقم ${originalIndex + 1}`);
      playBtn.textContent = "▶";
      playBtn.addEventListener("click", () => toggleHistoryPreview(entry, playBtn));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "pl-ctrl-btn pl-delete";
      delBtn.setAttribute("aria-label", `حذف النسخة رقم ${originalIndex + 1}`);
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", async () => {
        const ok = await showConfirm("حذف هذه النسخة من السجل نهائيًا؟ (هذا لا يحذف تسجيلك الحالي الفعّال)");
        if (!ok) return;
        stopHistoryPreview();
        await QuranDB.deleteHistoryEntry(entry.id);
        const fresh = await QuranDB.getHistoryForTarget(type, id);
        renderProgressLog(fresh, type, id);
      });
      controls.append(playBtn, delBtn);

      row.append(info, controls);
      el.progressLogList.appendChild(row);
    });
  }

  async function openProgressLogModal() {
    const { type, id } = state.recordTarget;
    el.progressLogTargetLabel.textContent = `سجل تسجيلات: ${targetLabel(type, id)}`;
    el.progressLogModal.classList.remove("hidden");
    el.progressLogList.innerHTML = '<p class="playlist-empty">جارٍ التحميل…</p>';
    el.progressLogCompareRow.classList.add("hidden");
    try {
      const history = await QuranDB.getHistoryForTarget(type, id);
      renderProgressLog(history, type, id);
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.progressLogBody, err);
        return;
      }
      el.progressLogList.innerHTML = '<p class="playlist-empty">تعذّر تحميل سجل التقدّم</p>';
    }
  }

  // =========================================================================
  // ===== علامات مواضع الأخطاء على صورة الصفحة (جديد) =====
  // =========================================================================

  // يحسب موضع البكسل لعلامة (نسبةً لصورة الصفحة الفعلية المعروضة، لا لإطارها،
  // حتى تبقى صحيحة رغم اختلاف أبعاد الصورة عن أبعاد الإطار المحيط بها)
  function computeMarkPixelPositionIn(wrapEl, imgEl, xPercent, yPercent) {
    const wrapRect = wrapEl.getBoundingClientRect();
    const imgRect = imgEl.getBoundingClientRect();
    const offsetX = imgRect.left - wrapRect.left;
    const offsetY = imgRect.top - wrapRect.top;
    return {
      left: offsetX + (xPercent / 100) * imgRect.width,
      top: offsetY + (yPercent / 100) * imgRect.height,
    };
  }

  // "متحكّم علامات" مستقل قابل لإنشاء أكثر من نسخة منه في آن واحد — نسخة واحدة
  // لعرض الصفحة الرئيسي، ونسخة مستقلة لكل بطاقة في شاشة مراجعة اختبار الحفظ،
  // كلها تقرأ/تكتب من نفس مخزن "errorMarks" بحسب رقم الصفحة.
  function createMarkController({ wrapEl, imgEl, layerEl, badgeEl, toggleBtn, hintEl, getPage }) {
    let marks = [];
    let active = false;

    function makeDot(mark) {
      const dot = document.createElement("div");
      dot.className = "error-mark";
      dot.dataset.markId = mark.id;
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", "حذف علامة الخطأ هذه");
      dot.textContent = "×";
      const pos = computeMarkPixelPositionIn(wrapEl, imgEl, mark.xPercent, mark.yPercent);
      dot.style.left = pos.left + "px";
      dot.style.top = pos.top + "px";
      const onDelete = (e) => { e.stopPropagation(); removeMark(mark.id); };
      dot.addEventListener("click", onDelete);
      let pressTimer = null;
      const startPress = (e) => { pressTimer = setTimeout(() => onDelete(e), 550); };
      const cancelPress = () => clearTimeout(pressTimer);
      dot.addEventListener("touchstart", startPress, { passive: true });
      dot.addEventListener("touchend", cancelPress);
      dot.addEventListener("touchmove", cancelPress);
      dot.addEventListener("mousedown", startPress);
      dot.addEventListener("mouseup", cancelPress);
      dot.addEventListener("mouseleave", cancelPress);
      return dot;
    }

    function render() {
      layerEl.innerHTML = "";
      marks.forEach((m) => layerEl.appendChild(makeDot(m)));
      updateBadge();
    }

    function reposition() {
      if (!marks.length) return;
      layerEl.querySelectorAll(".error-mark").forEach((dot) => {
        const m = marks.find((x) => String(x.id) === dot.dataset.markId);
        if (!m) return;
        const pos = computeMarkPixelPositionIn(wrapEl, imgEl, m.xPercent, m.yPercent);
        dot.style.left = pos.left + "px";
        dot.style.top = pos.top + "px";
      });
    }

    function updateBadge() {
      if (!badgeEl) return;
      const n = marks.length;
      badgeEl.textContent = `عدد الأخطاء الحالية: ${n}`;
      badgeEl.classList.toggle("hidden", n === 0 && !active);
    }

    async function persist() {
      try { await QuranDB.saveErrorMarks(getPage(), marks); }
      catch (e) { showToast("تعذّر حفظ علامات هذه الصفحة"); }
    }

    async function load() {
      try { marks = await QuranDB.getErrorMarks(getPage()); }
      catch (e) { marks = []; }
      render();
    }

    function addAtClientXY(clientX, clientY) {
      const imgRect = imgEl.getBoundingClientRect();
      if (imgRect.width === 0 || imgRect.height === 0) return;
      let xPercent = ((clientX - imgRect.left) / imgRect.width) * 100;
      let yPercent = ((clientY - imgRect.top) / imgRect.height) * 100;
      if (xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) return;
      xPercent = Math.max(0, Math.min(100, xPercent));
      yPercent = Math.max(0, Math.min(100, yPercent));
      marks.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, xPercent, yPercent, createdAt: Date.now() });
      render();
      persist();
    }

    function removeMark(markId) {
      marks = marks.filter((m) => String(m.id) !== String(markId));
      render();
      persist();
    }

    function setActive(next) {
      active = next;
      if (toggleBtn) toggleBtn.setAttribute("aria-pressed", active ? "true" : "false");
      if (hintEl) hintEl.classList.toggle("hidden", !active);
      wrapEl.classList.toggle("mark-mode-active", active);
      updateBadge();
    }

    wrapEl.addEventListener("click", (e) => {
      if (!active) return;
      if (imgEl.classList.contains("hidden")) return;
      addAtClientXY(e.clientX, e.clientY);
    });
    if (toggleBtn) toggleBtn.addEventListener("click", () => setActive(!active));

    let resizeTimer = null;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(reposition, 120); });

    return { load, render, reposition, setActive, isActive: () => active };
  }

  // المتحكّم الرئيسي لصورة الصفحة المعروضة في الشاشة الأساسية
  const mainMarkController = createMarkController({
    wrapEl: el.pageImageWrap, imgEl: el.pageImage, layerEl: el.errorMarksLayer,
    badgeEl: el.errorCountBadge, toggleBtn: el.markErrorModeBtn, hintEl: el.markModeHint,
    getPage: () => state.currentPage,
  });

  async function loadErrorMarksForPage(pageNum) {
    if (state.currentPage !== pageNum) return;
    await mainMarkController.load();
  }

  async function openErrorStatsModal() {
    el.errorStatsModal.classList.remove("hidden");
    el.errorStatsList.innerHTML = '<p class="playlist-empty">جارٍ التحميل…</p>';
    try {
      const rows = await QuranDB.getAllErrorMarkPages();
      if (rows.length === 0) {
        el.errorStatsList.innerHTML = '<p class="playlist-empty">لم تضع أي علامة خطأ بعد. افتح أي صفحة واضغط "وضع علامة خطأ" للبدء.</p>';
        return;
      }
      el.errorStatsList.innerHTML = "";
      rows.forEach((r) => {
        const n = (r.marks || []).length;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "error-stats-row";
        row.innerHTML =
          `<span class="error-stats-page">صفحة ${r.page}</span>` +
          `<span class="error-stats-count ${n === 0 ? "zero" : "nonzero"}">${n === 0 ? "0" : `${n} ${n === 1 ? "خطأ" : "أخطاء"}`}</span>`;
        row.addEventListener("click", () => {
          el.errorStatsModal.classList.add("hidden");
          setModeUI("page");
          loadPage(r.page);
        });
        el.errorStatsList.appendChild(row);
      });
    } catch (err) {
      if (isStructuralDbError(err)) {
        renderDbRecoveryAction(el.errorStatsBody, err);
        return;
      }
      el.errorStatsList.innerHTML = '<p class="playlist-empty">تعذّر تحميل الإحصائيات</p>';
    }
  }

  // ========================================================================
  // ===== بطاقات الأخطاء الذكية (Smart Mistake Cards) — جديد           =====
  // ========================================================================
  // ملاحظة مهمة وصادقة: هذا المصحف صور صفحات فقط (لا يملك التطبيق نص كل آية
  // مخزَّنًا بالكامل في مكان واحد). لذلك تُملأ تلقائيًا كل بيانات نثق بها فعلاً
  // (رقم الصفحة، قائمة الآيات المتاحة على الصفحة من js/pages.js)، بينما نص
  // الآية نفسه يكتبه المستخدم بيده — مع اقتراح تلقائي لبداية الآية فقط من بنك
  // أسئلة اختبار الحفظ (js/quiz-pool)، لأنه النص الوحيد المتوفر فعليًا داخل
  // التطبيق والمُدقَّق سابقًا، مع تنبيه صريح أنه اقتراح جزئي يحتاج إكمالًا وتأكّدًا.
  // مزامنة Firebase غير مفعَّلة هنا (تحتاج مشروع Firebase خاص بصاحب التطبيق)؛
  // كل شيء يعمل محليًا بالكامل عبر IndexedDB مثل بقية میزات التطبيق.

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function splitAyahWords(text) {
    return (text || "").split(/\s+/).filter(Boolean);
  }

  // يبني HTML لنص الآية مع تمييز الكلمات الموجودة في markedWords باللون الأحمر،
  // محافظًا على المسافات الأصلية بين الكلمات كما كُتبت تمامًا.
  function renderAyahHTML(text, markedWords) {
    if (!text) return "";
    const marked = markedWords || [];
    const tokens = String(text).split(/(\s+)/);
    return tokens.map((tok) => {
      if (tok === "" || /^\s+$/.test(tok)) return escapeHTML(tok);
      const escaped = escapeHTML(tok);
      return marked.includes(tok) ? `<span class="mc-mistake-word">${escaped}</span>` : escaped;
    }).join("");
  }

  function genMistakeCardId() {
    return `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // تاريخ رقمي بسيط (يوم/شهر/سنة) خاص ببطاقات الأخطاء — يتفادى أسماء الأشهر
  // نهائيًا (لا "أغسطس" ولا "أوت") حتى لا يلتبس على أي قارئ مهما كانت لهجته.
  function formatMcDate(timestamp) {
    const d = new Date(timestamp);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  }

  // يملأ قائمة الآيات المتاحة في صفحة معيّنة (قد تحوي الصفحة أكثر من سورة عند
  // صفحات الانتقال بين سورتين)، بالاعتماد على QURAN_PAGES المحقَّقة فعليًا.
  function populateMcAyahSelect(pageNum) {
    const segments = QURAN_PAGES[pageNum] || [];
    el.mcAyahSelect.innerHTML = "";
    segments.forEach((seg) => {
      const surah = surahByNumber(seg.surah);
      const surahName = surah ? surah.name : `${seg.surah}`;
      for (let a = seg.ayahStart; a <= seg.ayahEnd; a++) {
        const opt = document.createElement("option");
        opt.value = `${seg.surah}:${a}`;
        opt.textContent = `سورة ${surahName} — آية ${a}`;
        el.mcAyahSelect.appendChild(opt);
      }
    });
    if (el.mcAyahSelect.options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "تعذّر تحديد آيات هذه الصفحة";
      el.mcAyahSelect.appendChild(opt);
    }
  }

  // اقتراح جزئي لبداية الآية من بنك أسئلة اختبار الحفظ (نفس النص المُدقَّق
  // المستخدم في اختبار حفظ الأحزاب) — يُعيد null بصمت عند أي فشل أو صفحة غير مغطاة
  // (الفاتحة وأول صفحة من البقرة مستثناتان من بنك الأسئلة، كما في باقي التطبيق).
  async function fetchAyahPrefixHint(pageNum, surahNum, ayahNum) {
    try {
      const hizb = hizbForPage(pageNum);
      if (!hizb) return null;
      const pool = await fetchHizbPool(hizb.number);
      const entry = (pool || []).find((q) => q.surah === surahNum && q.ayah === ayahNum);
      return entry ? entry.prefix : null;
    } catch (e) {
      return null;
    }
  }

  function renderWordPicker() {
    const text = el.mcAyahText.value;
    const words = splitAyahWords(text);
    el.mcWordPicker.innerHTML = "";
    if (words.length === 0) {
      const p = document.createElement("p");
      p.className = "mc-word-picker-empty";
      p.id = "mcWordPickerEmpty";
      p.textContent = "اكتب نص الآية أعلاه أولًا";
      el.mcWordPicker.appendChild(p);
      return;
    }
    words.forEach((w) => {
      const span = document.createElement("span");
      span.className = "mc-word" + (state.mc.markedWords.has(w) ? " marked" : "");
      span.textContent = w;
      span.setAttribute("role", "button");
      span.addEventListener("click", () => {
        if (state.mc.markedWords.has(w)) state.mc.markedWords.delete(w);
        else state.mc.markedWords.add(w);
        renderWordPicker();
      });
      el.mcWordPicker.appendChild(span);
    });
  }

  // يُستدعى عند اختيار آية جديدة في نافذة الإنشاء/التعديل. لا يكتب فوق نص كتبه
  // المستخدم يدويًا أبدًا — فقط عندما يكون الحقل فارغًا أو لا يزال يطابق آخر
  // اقتراح تلقائي وضعناه نحن بالضبط. الأولوية: (١) نص سبق للمستخدم كتابته لنفس
  // الآية (محفوظ محليًا، ثقة كاملة)، ثم (٢) اقتراح جزئي من بنك أسئلة الحزب.
  async function onMcAyahSelectChange() {
    const val = el.mcAyahSelect.value;
    el.mcAutoFillHint.classList.add("hidden");
    if (!val) return;
    const parts = val.split(":");
    const surahNum = parseInt(parts[0], 10);
    const ayahNum = parseInt(parts[1], 10);
    const pageNum = parseInt(el.mcCardPage.value, 10);
    const canOverwrite = el.mcAyahText.value === "" || el.mcAyahText.value === state.mc.autoFilledText;
    if (!canOverwrite) return;

    let cached = null;
    try { cached = await QuranDB.getCachedAyahText(surahNum, ayahNum); } catch (e) { cached = null; }
    if (el.mcAyahSelect.value !== val) return; // بدّل المستخدم الآية أثناء الانتظار

    if (cached && cached.text) {
      el.mcAyahText.value = cached.text;
      state.mc.autoFilledText = cached.text;
      el.mcAutoFillHint.textContent = "✅ هذا النص محفوظ من إدخالك السابق لهذه الآية — راجعه سريعًا فقط، ولا حاجة لإعادة كتابته.";
      el.mcAutoFillHint.classList.remove("hidden");
      state.mc.markedWords.clear();
      renderWordPicker();
      return;
    }

    const prefix = await fetchAyahPrefixHint(pageNum, surahNum, ayahNum);
    if (el.mcAyahSelect.value !== val) return;
    if (prefix) {
      el.mcAyahText.value = prefix;
      state.mc.autoFilledText = prefix;
      el.mcAutoFillHint.textContent = "اقتراح تلقائي لبداية الآية فقط من بيانات الحزب — أكمِله وتأكّد منه، فالتطبيق لا يملك نص المصحف كاملاً (صور فقط). بعد أول مرة تكتبه، سيُحفظ ويُملأ تلقائيًا للمرات القادمة.";
      el.mcAutoFillHint.classList.remove("hidden");
    } else {
      el.mcAyahText.value = "";
      state.mc.autoFilledText = "";
    }
    state.mc.markedWords.clear();
    renderWordPicker();
  }

  // نقطة الدخول الوحيدة لفتح نافذة الإنشاء/التعديل، سواء من زر الصفحة الحالية
  // أو من صف بطاقة في شاشة الإدارة (وقتها page/card تخصّان تلك البطاقة تحديدًا،
  // وقد تختلفان عن الصفحة المفتوحة حاليًا في المصحف).
  async function openMistakeCardModal({ mode, page, card }) {
    state.mc.editingId = mode === "edit" ? card.id : null;
    state.mc.markedWords = new Set(mode === "edit" ? (card.mistakeWords || []) : []);
    state.mc.autoFilledText = null;
    el.mcModalTitle.textContent = mode === "edit" ? "تعديل بطاقة الخطأ" : "بطاقة خطأ جديدة";
    el.mcSaveBtn.textContent = mode === "edit" ? "حفظ التعديلات" : "حفظ البطاقة";
    el.mcEditingCardId.value = mode === "edit" ? card.id : "";
    el.mcCardPage.value = String(page);
    el.mcSurahPageLabel.textContent = `الصفحة ${page}`;
    el.mcAutoFillHint.classList.add("hidden");
    populateMcAyahSelect(page);

    if (mode === "edit") {
      el.mcAyahSelect.value = `${card.surahNumber}:${card.ayah}`;
      el.mcAyahText.value = card.ayahText || "";
      el.mcNoteText.value = card.note || "";
    } else {
      el.mcAyahText.value = "";
      el.mcNoteText.value = "";
      if (el.mcAyahSelect.options.length && el.mcAyahSelect.options[0].value) {
        el.mcAyahSelect.selectedIndex = 0;
        await onMcAyahSelectChange();
      }
    }
    renderWordPicker();
    el.createMistakeCardModal.classList.remove("hidden");
  }

  async function saveMistakeCardFromModal() {
    const ayahVal = el.mcAyahSelect.value;
    if (!ayahVal) { showToast("اختر الآية أولًا"); return; }
    const parts = ayahVal.split(":");
    const surahNum = parseInt(parts[0], 10);
    const ayahNum = parseInt(parts[1], 10);
    const text = el.mcAyahText.value.trim();
    if (!text) { showToast("اكتب نص الآية أولًا"); return; }
    const page = parseInt(el.mcCardPage.value, 10);
    const surah = surahByNumber(surahNum);
    const note = el.mcNoteText.value.trim();
    const validWords = new Set(splitAyahWords(text));
    const markedWords = Array.from(state.mc.markedWords).filter((w) => validWords.has(w));
    if (markedWords.length === 0) {
      showToast("لم تُحدَّد كلمة الخطأ — يمكنك المتابعة، لكن يُفضَّل الضغط عليها لتمييزها");
    }

    const now = Date.now();
    const hizb = hizbForPage(page);
    const juz = juzForPage(page);
    el.mcSaveBtn.disabled = true;
    try {
      if (state.mc.editingId) {
        const existing = await QuranDB.getMistakeCard(state.mc.editingId);
        const card = Object.assign({}, existing, {
          page, surahNumber: surahNum, surahName: surah ? surah.name : "",
          ayah: ayahNum, ayahText: text, mistakeWords: markedWords, note,
          hizbNumber: hizb ? hizb.number : null, juzNumber: juz ? juz.number : null,
          updatedAt: now,
        });
        await QuranDB.saveMistakeCard(card);
        showToast("تم تحديث البطاقة");
      } else {
        const card = {
          id: genMistakeCardId(), page, surahNumber: surahNum, surahName: surah ? surah.name : "",
          ayah: ayahNum, ayahText: text, mistakeWords: markedWords, note,
          hizbNumber: hizb ? hizb.number : null, juzNumber: juz ? juz.number : null,
          status: "active", createdAt: now, updatedAt: now,
          reviewCount: 0, timesWrong: 0, reviewStageIndex: 0,
          nextReviewAt: now + MC_REVIEW_INTERVALS_DAYS[0] * MC_DAY_MS,
          lastReviewedAt: null, masteredAt: null,
        };
        await QuranDB.saveMistakeCard(card);
        showToast("تم حفظ بطاقة الخطأ");
      }
      try { await QuranDB.saveCachedAyahText(surahNum, ayahNum, text); } catch (e) { /* لا يوقف حفظ البطاقة نفسها */ }
      el.createMistakeCardModal.classList.add("hidden");
      if (state.currentPage === page) refreshMistakeIndicatorForCurrentPage();
    } catch (e) {
      if (isStructuralDbError(e)) showToast("مشكلة في قاعدة البيانات المحلية — حدّث الصفحة وأعد المحاولة");
      else showToast("تعذّر حفظ البطاقة، حاول مجددًا");
    } finally {
      el.mcSaveBtn.disabled = false;
    }
  }

  // ===== رمز التنبيه في زاوية الصفحة =====
  async function refreshMistakeIndicatorForPage(pageNum) {
    closeFloatingCards();
    try {
      const cards = await QuranDB.getMistakeCardsForPage(pageNum);
      if (state.currentPage !== pageNum) return;
      const active = cards.filter((c) => c.status !== "mastered");
      if (active.length > 0) {
        el.mistakeCardIndicator.classList.remove("hidden");
        el.mistakeCardIndicatorCount.textContent = String(active.length);
      } else {
        el.mistakeCardIndicator.classList.add("hidden");
      }
    } catch (e) {
      el.mistakeCardIndicator.classList.add("hidden");
    }
  }
  function refreshMistakeIndicatorForCurrentPage() { refreshMistakeIndicatorForPage(state.currentPage); }

  // ===== البطاقة العائمة فوق صورة الصفحة (سحب/تصغير-تكبير/تنقّل بين عدة بطاقات) =====
  function closeFloatingCards() {
    el.floatingCardLayer.innerHTML = "";
    el.pageImageWrap.classList.remove("has-floating-card");
    state.mc.openFloating = null;
  }

  async function openFloatingCardsForPage(pageNum) {
    try {
      const cards = (await QuranDB.getMistakeCardsForPage(pageNum))
        .filter((c) => c.status !== "mastered")
        .sort((a, b) => a.createdAt - b.createdAt);
      if (cards.length === 0) { showToast("لا توجد بطاقات نشطة لهذه الصفحة"); return; }
      state.mc.openFloating = { page: pageNum, cards, index: 0 };
      renderFloatingCard();
    } catch (e) {
      showToast("تعذّر تحميل بطاقات هذه الصفحة");
    }
  }

  function setupFloatingCardDrag(box, handle) {
    let pointerId = null, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    function onMove(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const wrapRect = el.pageImageWrap.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      let newLeft = startLeft + (e.clientX - startX);
      let newTop = startTop + (e.clientY - startY);
      newLeft = Math.max(0, Math.min(Math.max(0, wrapRect.width - boxRect.width), newLeft));
      newTop = Math.max(0, Math.min(Math.max(wrapRect.height, boxRect.height) - boxRect.height, newTop));
      box.style.left = newLeft + "px";
      box.style.top = newTop + "px";
      if (e.cancelable) e.preventDefault();
    }
    function onUp(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      cleanup();
    }
    function cleanup() {
      pointerId = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".fmc-icon-btn") || e.target.closest(".fmc-nav-btn")) return;
      pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startLeft = box.offsetLeft; startTop = box.offsetTop;
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      e.stopPropagation();
    });
  }

  function setupFloatingCardResize(box, handle) {
    let pointerId = null, startX = 0, startY = 0, startW = 0, startH = 0;
    function onMove(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const wrapRect = el.pageImageWrap.getBoundingClientRect();
      let newW = startW - (e.clientX - startX);
      let newH = startH + (e.clientY - startY);
      newW = Math.max(190, Math.min(wrapRect.width - box.offsetLeft, newW));
      newH = Math.max(70, Math.min(420, newH));
      box.style.width = newW + "px";
      box.style.height = newH + "px";
      if (e.cancelable) e.preventDefault();
    }
    function onUp(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      cleanup();
    }
    function cleanup() {
      pointerId = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointerdown", (e) => {
      pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startW = box.offsetWidth; startH = box.offsetHeight;
      box.style.height = startH + "px";
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      e.stopPropagation();
    });
  }

  function renderFloatingCard() {
    const f = state.mc.openFloating;
    if (!f) return;
    const card = f.cards[f.index];
    el.floatingCardLayer.innerHTML = "";
    el.pageImageWrap.classList.add("has-floating-card");

    const box = document.createElement("div");
    box.className = "floating-mistake-card";
    box.style.left = "10px";
    box.style.top = "40px";
    box.style.width = "240px";

    const header = document.createElement("div");
    header.className = "fmc-header";

    const grip = document.createElement("span");
    grip.className = "fmc-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "⠿";
    header.appendChild(grip);

    const title = document.createElement("span");
    title.className = "fmc-title";
    title.textContent = "بطاقة خطأ";
    header.appendChild(title);

    if (f.cards.length > 1) {
      const nav = document.createElement("span");
      nav.className = "fmc-nav";
      const prevBtn = document.createElement("button");
      prevBtn.type = "button"; prevBtn.className = "fmc-nav-btn"; prevBtn.textContent = "›";
      prevBtn.setAttribute("aria-label", "البطاقة السابقة");
      const countSpan = document.createElement("span");
      countSpan.textContent = `${f.index + 1}/${f.cards.length}`;
      const nextBtn = document.createElement("button");
      nextBtn.type = "button"; nextBtn.className = "fmc-nav-btn"; nextBtn.textContent = "‹";
      nextBtn.setAttribute("aria-label", "البطاقة التالية");
      prevBtn.addEventListener("click", (e) => { e.stopPropagation(); f.index = (f.index - 1 + f.cards.length) % f.cards.length; renderFloatingCard(); });
      nextBtn.addEventListener("click", (e) => { e.stopPropagation(); f.index = (f.index + 1) % f.cards.length; renderFloatingCard(); });
      nav.appendChild(prevBtn); nav.appendChild(countSpan); nav.appendChild(nextBtn);
      header.appendChild(nav);
    }

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button"; collapseBtn.className = "fmc-icon-btn";
    collapseBtn.setAttribute("aria-label", "تصغير/تكبير البطاقة");
    collapseBtn.textContent = "–";
    collapseBtn.addEventListener("click", (e) => { e.stopPropagation(); box.classList.toggle("collapsed"); });
    header.appendChild(collapseBtn);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.className = "fmc-icon-btn";
    closeBtn.setAttribute("aria-label", "إغلاق البطاقة");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closeFloatingCards(); });
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "fmc-body";

    const meta = document.createElement("p");
    meta.className = "fmc-meta";
    meta.textContent = `${card.surahName ? "سورة " + card.surahName : ""} — صفحة ${card.page} — آية ${card.ayah}`;
    body.appendChild(meta);

    const ayahP = document.createElement("p");
    ayahP.className = "mc-ayah-text";
    ayahP.innerHTML = renderAyahHTML(card.ayahText, card.mistakeWords);
    body.appendChild(ayahP);

    if (card.note) {
      const noteP = document.createElement("p");
      noteP.className = "fmc-note";
      noteP.textContent = card.note;
      body.appendChild(noteP);
    }

    const footer = document.createElement("div");
    footer.className = "fmc-footer";
    const stats = document.createElement("span");
    stats.className = "fmc-footer-stats";
    stats.textContent = `${formatMcDate(card.createdAt)} · روجعت ${card.reviewCount || 0} ${(card.reviewCount || 0) === 1 ? "مرة" : "مرات"}`;
    footer.appendChild(stats);
    const masterBtn = document.createElement("button");
    masterBtn.type = "button";
    masterBtn.className = "ctrl-btn fmc-master-btn";
    masterBtn.textContent = "✅ تم الإتقان";
    masterBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleCardMastered(card, true);
      f.cards.splice(f.index, 1);
      if (f.cards.length === 0) { closeFloatingCards(); refreshMistakeIndicatorForCurrentPage(); return; }
      f.index = f.index % f.cards.length;
      renderFloatingCard();
      refreshMistakeIndicatorForCurrentPage();
    });
    footer.appendChild(masterBtn);
    body.appendChild(footer);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "fmc-resize-handle";
    resizeHandle.setAttribute("aria-hidden", "true");

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(resizeHandle);
    el.floatingCardLayer.appendChild(box);

    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    setupFloatingCardDrag(box, header);
    setupFloatingCardResize(box, resizeHandle);
  }

  // ===== تبديل حالة "تم الإتقان" وحذف البطاقات =====
  async function toggleCardMastered(card, toMastered) {
    try {
      const existing = await QuranDB.getMistakeCard(card.id);
      if (!existing) return;
      existing.status = toMastered ? "mastered" : "active";
      existing.masteredAt = toMastered ? Date.now() : null;
      existing.updatedAt = Date.now();
      await QuranDB.saveMistakeCard(existing);
      showToast(toMastered ? "أُضيفت للبطاقات المتقنة 🎉" : "أُعيدت البطاقة إلى القائمة النشطة");
    } catch (e) {
      showToast("تعذّر تحديث حالة البطاقة");
    }
  }

  async function deleteMistakeCardWithConfirm(card, onDone) {
    const ok = await showConfirm("سيتم حذف هذه البطاقة نهائيًا. هل تريد المتابعة؟");
    if (!ok) return;
    try {
      await QuranDB.deleteMistakeCard(card.id);
      showToast("تم حذف البطاقة");
      if (onDone) onDone();
      if (state.currentPage === card.page) refreshMistakeIndicatorForCurrentPage();
    } catch (e) {
      showToast("تعذّر حذف البطاقة");
    }
  }

  // ===== نافذة إدارة بطاقات الأخطاء (بحث/تصفية/ترتيب) =====
  async function openMistakeCardsModal() {
    el.mistakeCardsModal.classList.remove("hidden");
    populateMcFilterScope();
    await renderMistakeCardsList();
  }

  function populateMcFilterScope() {
    if (el.mcFilterScope.dataset.populated === "1") return;
    el.mcFilterScope.dataset.populated = "1";
    el.mcFilterScope.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "كل البطاقات";
    el.mcFilterScope.appendChild(allOpt);

    const juzGroup = document.createElement("optgroup");
    juzGroup.label = "تصفية حسب الجزء";
    QURAN_JUZ.forEach((j) => {
      const opt = document.createElement("option");
      opt.value = `juz:${j.number}`;
      opt.textContent = `الجزء ${j.number}`;
      juzGroup.appendChild(opt);
    });
    el.mcFilterScope.appendChild(juzGroup);

    const hizbGroup = document.createElement("optgroup");
    hizbGroup.label = "تصفية حسب الحزب";
    QURAN_AHZAB.forEach((h) => {
      const opt = document.createElement("option");
      opt.value = `hizb:${h.number}`;
      opt.textContent = `${h.number}. ${h.name}`;
      hizbGroup.appendChild(opt);
    });
    el.mcFilterScope.appendChild(hizbGroup);
  }

  async function renderMistakeCardsList() {
    el.mistakeCardsList.innerHTML = '<p class="playlist-empty">جارٍ التحميل…</p>';
    let all;
    try {
      all = await QuranDB.getAllMistakeCards();
    } catch (e) {
      if (isStructuralDbError(e)) { renderDbRecoveryAction(el.mistakeCardsListBody, e); return; }
      el.mistakeCardsList.innerHTML = '<p class="mc-list-empty">تعذّر تحميل البطاقات</p>';
      return;
    }

    const showMastered = el.mcShowMasteredToggle.checked;
    const query = el.mcSearchInput.value.trim();
    const scope = el.mcFilterScope.value;
    const sortMode = el.mcSortSelect.value;

    let list = all.filter((c) => showMastered || c.status !== "mastered");
    if (query) {
      list = list.filter((c) =>
        (c.surahName && c.surahName.includes(query)) ||
        (c.ayahText && c.ayahText.includes(query)) ||
        (c.note && c.note.includes(query)) ||
        (c.mistakeWords || []).some((w) => w.includes(query))
      );
    }
    if (scope) {
      const scopeParts = scope.split(":");
      const kind = scopeParts[0];
      const num = parseInt(scopeParts[1], 10);
      list = list.filter((c) => (kind === "juz" ? c.juzNumber === num : c.hizbNumber === num));
    }
    if (sortMode === "mostWrong") {
      list = list.slice().sort((a, b) => ((b.timesWrong || 0) - (a.timesWrong || 0)) || ((b.reviewCount || 0) - (a.reviewCount || 0)) || (b.createdAt - a.createdAt));
    } else {
      list = list.slice().sort((a, b) => b.createdAt - a.createdAt);
    }

    if (list.length === 0) {
      el.mistakeCardsList.innerHTML = all.length === 0
        ? '<p class="mc-list-empty">لا توجد بطاقات أخطاء بعد. افتح أي صفحة واضغط "إنشاء بطاقة خطأ ذكية" للبدء.</p>'
        : '<p class="mc-list-empty">لا توجد بطاقات مطابقة لبحثك أو تصفيتك الحالية.</p>';
      return;
    }

    el.mistakeCardsList.innerHTML = "";
    list.forEach((card) => el.mistakeCardsList.appendChild(buildMcCardRow(card)));
  }

  function buildMcCardRow(card) {
    const row = document.createElement("div");
    row.className = "mc-card-row" + (card.status === "mastered" ? " mastered" : "");

    const head = document.createElement("div");
    head.className = "mc-card-row-head";
    const meta = document.createElement("span");
    meta.className = "mc-card-meta";
    meta.textContent = `${card.surahName ? "سورة " + card.surahName : ""} — صفحة ${card.page} — آية ${card.ayah}`;
    head.appendChild(meta);
    if (card.status === "mastered") {
      const pill = document.createElement("span");
      pill.className = "mc-status-pill";
      pill.textContent = "✅ متقنة";
      head.appendChild(pill);
    }
    row.appendChild(head);

    const textEl = document.createElement("p");
    textEl.className = "mc-ayah-text mc-ayah-text-sm";
    textEl.innerHTML = renderAyahHTML(card.ayahText, card.mistakeWords);
    row.appendChild(textEl);

    if (card.note) {
      const note = document.createElement("p");
      note.className = "mc-card-note";
      note.textContent = card.note;
      row.appendChild(note);
    }

    const footRow = document.createElement("div");
    footRow.className = "mc-card-footer-row";
    const stats = document.createElement("span");
    stats.className = "mc-card-stats";
    const s1 = document.createElement("span"); s1.textContent = `📅 ${formatMcDate(card.createdAt)}`;
    const s2 = document.createElement("span"); s2.textContent = `🔁 روجعت ${card.reviewCount || 0}`;
    const s3 = document.createElement("span"); s3.textContent = `❌ تكرر ${card.timesWrong || 0}`;
    stats.appendChild(s1); stats.appendChild(s2); stats.appendChild(s3);
    footRow.appendChild(stats);

    const actions = document.createElement("div");
    actions.className = "mc-card-actions";

    const gotoBtn = document.createElement("button");
    gotoBtn.type = "button"; gotoBtn.className = "mc-action-btn"; gotoBtn.setAttribute("aria-label", "فتح الصفحة");
    gotoBtn.textContent = "📖";
    gotoBtn.addEventListener("click", () => {
      el.mistakeCardsModal.classList.add("hidden");
      setModeUI("page");
      loadPage(card.page);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button"; editBtn.className = "mc-action-btn"; editBtn.setAttribute("aria-label", "تعديل");
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => {
      openMistakeCardModal({ mode: "edit", page: card.page, card });
    });

    const masterBtn = document.createElement("button");
    masterBtn.type = "button"; masterBtn.className = "mc-action-btn";
    masterBtn.setAttribute("aria-label", card.status === "mastered" ? "إرجاع كنشطة" : "تم الإتقان");
    masterBtn.textContent = card.status === "mastered" ? "↩️" : "✅";
    masterBtn.addEventListener("click", async () => {
      await toggleCardMastered(card, card.status !== "mastered");
      renderMistakeCardsList();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "mc-action-btn mc-delete"; delBtn.setAttribute("aria-label", "حذف");
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => {
      deleteMistakeCardWithConfirm(card, renderMistakeCardsList);
    });

    actions.appendChild(gotoBtn);
    actions.appendChild(editBtn);
    actions.appendChild(masterBtn);
    actions.appendChild(delBtn);
    footRow.appendChild(actions);
    row.appendChild(footRow);

    return row;
  }

  // ===== المراجعة الذكية المتباعدة ("راجع أخطائي") =====
  function computeDueMistakeCards(all, now) {
    return all.filter((c) => c.status !== "mastered" && c.nextReviewAt <= now);
  }

  async function openReviewMistakesModal() {
    el.reviewMistakesModal.classList.remove("hidden");
    el.reviewSetup.classList.remove("hidden");
    el.reviewRun.classList.add("hidden");
    el.reviewDone.classList.add("hidden");
    el.reviewDueCount.textContent = "جارٍ التحميل…";
    el.reviewStartBtn.disabled = true;
    try {
      const all = await QuranDB.getAllMistakeCards();
      const due = computeDueMistakeCards(all, Date.now());
      state.mc.reviewQueue = due;
      if (due.length === 0) {
        el.reviewDueCount.textContent = "لا توجد بطاقات مستحقة الآن — أحسنت! عُد لاحقًا.";
        el.reviewStartBtn.disabled = true;
      } else {
        el.reviewDueCount.textContent = `عدد البطاقات المستحقة للمراجعة الآن: ${due.length}`;
        el.reviewStartBtn.disabled = false;
      }
    } catch (e) {
      if (isStructuralDbError(e)) { renderDbRecoveryAction(el.reviewSetup, e); return; }
      el.reviewDueCount.textContent = "تعذّر تحميل البطاقات المستحقة";
    }
  }

  function startReviewSession() {
    const queue = state.mc.reviewQueue || [];
    if (queue.length === 0) return;
    state.mc.reviewIndex = 0;
    el.reviewSetup.classList.add("hidden");
    el.reviewDone.classList.add("hidden");
    el.reviewRun.classList.remove("hidden");
    renderReviewCard();
  }

  function renderReviewCard() {
    const queue = state.mc.reviewQueue;
    const idx = state.mc.reviewIndex;
    if (idx >= queue.length) { finishReviewSession(); return; }
    const card = queue[idx];
    el.reviewProgressText.textContent = `البطاقة ${idx + 1} من ${queue.length}`;
    el.reviewProgressFill.style.width = `${(idx / queue.length) * 100}%`;
    el.reviewCardMeta.textContent = `${card.surahName ? "سورة " + card.surahName : ""} — صفحة ${card.page} — آية ${card.ayah}`;
    el.reviewCardAyahText.innerHTML = renderAyahHTML(card.ayahText, card.mistakeWords);
    if (card.note) {
      el.reviewCardNote.textContent = card.note;
      el.reviewCardNote.classList.remove("hidden");
    } else {
      el.reviewCardNote.classList.add("hidden");
    }
  }

  async function answerReviewCard(gotItRight) {
    const queue = state.mc.reviewQueue;
    const idx = state.mc.reviewIndex;
    const card = queue[idx];
    if (!card) return;
    el.reviewStillWrongBtn.disabled = true;
    el.reviewMasteredBtn.disabled = true;
    try {
      const fresh = await QuranDB.getMistakeCard(card.id);
      const target = fresh || card;
      const now = Date.now();
      target.reviewCount = (target.reviewCount || 0) + 1;
      target.lastReviewedAt = now;
      if (gotItRight) {
        target.reviewStageIndex = Math.min((target.reviewStageIndex || 0) + 1, MC_REVIEW_INTERVALS_DAYS.length - 1);
      } else {
        target.timesWrong = (target.timesWrong || 0) + 1;
        target.reviewStageIndex = 0;
      }
      target.nextReviewAt = now + MC_REVIEW_INTERVALS_DAYS[target.reviewStageIndex] * MC_DAY_MS;
      target.updatedAt = now;
      await QuranDB.saveMistakeCard(target);
    } catch (e) {
      showToast("تعذّر حفظ نتيجة المراجعة لهذه البطاقة");
    }
    el.reviewStillWrongBtn.disabled = false;
    el.reviewMasteredBtn.disabled = false;
    state.mc.reviewIndex += 1;
    renderReviewCard();
  }

  function finishReviewSession() {
    el.reviewRun.classList.add("hidden");
    el.reviewDone.classList.remove("hidden");
  }

  // ===== إحصائيات بطاقات الأخطاء =====
  async function openMistakeStatsModal() {
    el.mistakeStatsModal.classList.remove("hidden");
    el.mcStatsGrid.innerHTML = '<p class="playlist-empty">جارٍ التحميل…</p>';
    el.mcTopSurahsList.innerHTML = "";
    el.mcTopWordsList.innerHTML = "";
    try {
      const all = await QuranDB.getAllMistakeCards();
      renderMistakeStats(all);
    } catch (e) {
      if (isStructuralDbError(e)) { renderDbRecoveryAction(el.mistakeStatsBody, e); return; }
      el.mcStatsGrid.innerHTML = '<p class="mc-list-empty">تعذّر تحميل الإحصائيات</p>';
    }
  }

  function renderMistakeStats(all) {
    const total = all.length;
    const mastered = all.filter((c) => c.status === "mastered").length;
    const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

    el.mcStatsGrid.innerHTML =
      `<div class="mc-stat-tile"><span class="mc-stat-num">${total}</span><span class="mc-stat-label">إجمالي البطاقات</span></div>` +
      `<div class="mc-stat-tile"><span class="mc-stat-num">${mastered}</span><span class="mc-stat-label">بطاقات مُتقنة</span></div>` +
      `<div class="mc-stat-tile"><span class="mc-stat-num">${pct}%</span><span class="mc-stat-label">نسبة الإتقان</span></div>`;

    if (total === 0) {
      el.mcTopSurahsList.innerHTML = '<p class="mc-list-empty">لا توجد بيانات بعد</p>';
      el.mcTopWordsList.innerHTML = '<p class="mc-list-empty">لا توجد بيانات بعد</p>';
      return;
    }

    const surahCounts = {};
    all.forEach((c) => {
      const key = c.surahName || "—";
      surahCounts[key] = (surahCounts[key] || 0) + 1;
    });
    const topSurahs = Object.entries(surahCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    el.mcTopSurahsList.innerHTML = "";
    topSurahs.forEach((entry) => {
      const name = entry[0], count = entry[1];
      const row = document.createElement("div");
      row.className = "mc-rank-row";
      const nameSpan = document.createElement("span");
      nameSpan.className = "mc-rank-name";
      nameSpan.textContent = `سورة ${name}`;
      const countSpan = document.createElement("span");
      countSpan.className = "mc-rank-count";
      countSpan.textContent = String(count);
      row.appendChild(nameSpan); row.appendChild(countSpan);
      el.mcTopSurahsList.appendChild(row);
    });

    const wordCounts = {};
    all.forEach((c) => {
      (c.mistakeWords || []).forEach((w) => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
    });
    const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topWords.length === 0) {
      el.mcTopWordsList.innerHTML = '<p class="mc-list-empty">لم تُحدَّد كلمات أخطاء بعد</p>';
    } else {
      el.mcTopWordsList.innerHTML = "";
      topWords.forEach((entry) => {
        const word = entry[0], count = entry[1];
        const row = document.createElement("div");
        row.className = "mc-rank-row";
        const nameSpan = document.createElement("span");
        nameSpan.className = "mc-rank-name mc-rank-word";
        nameSpan.textContent = word;
        const countSpan = document.createElement("span");
        countSpan.className = "mc-rank-count";
        countSpan.textContent = String(count);
        row.appendChild(nameSpan); row.appendChild(countSpan);
        el.mcTopWordsList.appendChild(row);
      });
    }
  }


  // ===== ربط الأحداث: التبديل بين الأوضاع =====
  el.modePageBtn.addEventListener("click", () => {
    if (isMainRecordingActive()) {
      showToast("أوقف التسجيل الحالي أولًا");
      return;
    }
    if (state.mode === "page") return;
    setModeUI("page");
    loadPage(state.currentPage);
  });

  el.modeSurahBtn.addEventListener("click", () => {
    if (isMainRecordingActive()) {
      showToast("أوقف التسجيل الحالي أولًا");
      return;
    }
    if (state.mode === "surah") return;
    setModeUI("surah");
    const n = state.currentSurah ? state.currentSurah.number : surahForPage(state.currentPage).number;
    loadSurah(n);
  });

  el.modeHizbBtn.addEventListener("click", () => {
    if (isMainRecordingActive()) {
      showToast("أوقف التسجيل الحالي أولًا");
      return;
    }
    if (state.mode === "hizb") return;
    setModeUI("hizb");
    const n = state.currentHizb ? state.currentHizb.number : hizbForPage(state.currentPage).number;
    loadHizb(n);
  });

  el.surahSelect.addEventListener("change", () => {
    const n = parseInt(el.surahSelect.value, 10);
    if (!isNaN(n)) loadSurah(n);
  });

  el.hizbSelect.addEventListener("change", () => {
    const n = parseInt(el.hizbSelect.value, 10);
    if (!isNaN(n)) loadHizb(n);
  });

  el.surahExtendBtn.addEventListener("click", () => adjustSurahEndPage(1));
  el.surahShrinkBtn.addEventListener("click", () => adjustSurahEndPage(-1));

  // ===== ربط الأحداث: التشغيل =====
  el.playBtn.addEventListener("click", () => {
    if (state.isPlaying) pauseAudio();
    else playAudio();
  });

  el.stopBtn.addEventListener("click", () => {
    stopPlayback();
  });

  el.seekBar.addEventListener("input", () => {
    state.audio.currentTime = parseFloat(el.seekBar.value);
  });

  el.recordBtn.addEventListener("click", startRecording);
  el.pauseRecordBtn.addEventListener("click", togglePauseRecording);
  el.stopRecordBtn.addEventListener("click", stopRecording);

  el.deleteBtn.addEventListener("click", async () => {
    const type = state.recordTarget.type;
    const label = type === "surah" && state.currentSurah ? `سورة ${state.currentSurah.name}`
      : type === "hizb" && state.currentHizb ? state.currentHizb.name
      : `صفحة ${state.currentPage}`;
    const ok = await showConfirm(`هل تريد حذف تسجيل ${label} نهائيًا؟`);
    if (!ok) return;
    await deleteRecordByType(type, state.recordTarget.id);
    showToast("تم حذف التسجيل");
    if (type === "surah") loadSurah(state.recordTarget.id);
    else if (type === "hizb") loadHizb(state.recordTarget.id);
    else loadPage(state.recordTarget.id);
  });

  el.downloadBtn.addEventListener("click", async () => {
    if (!state.hasRecording) return;
    const type = state.recordTarget.type;
    const id = state.recordTarget.id;
    const label = type === "surah" && state.currentSurah ? `سورة ${state.currentSurah.name}`
      : type === "hizb" && state.currentHizb ? state.currentHizb.name
      : `صفحة ${id}`;
    const rec = await getRecordByType(type, id);
    if (!rec || !rec.blob) {
      showToast("لا يوجد تسجيل لتحميله");
      return;
    }
    const filename = buildRecordingFileName(type, id, rec.mimeType || rec.blob.type);
    await shareOrDownloadBlob(rec.blob, filename, label);
  });

  // ===== ربط الأحداث: التنقل بين الصفحات =====
  el.prevPage.addEventListener("click", () => goToAdjacentPage(-1));
  el.nextPage.addEventListener("click", () => goToAdjacentPage(1));

  // ===== السحب يمينًا/يسارًا للتنقل بين الصفحات (بلا قطع صوت تسجيل أو تشغيل جارٍ) =====
  // يعتمد على Pointer Events (يعمل باللمس وبالفأرة معًا بنفس الكود). يميّز بدقة بين:
  //  - نقرة عادية (تكبير الصورة أو وضع علامة خطأ — تبقى تعمل تمامًا كما كانت)
  //  - تمرير رأسي عادي لصفحة الويب (يُترك للمتصفح يتولاه بنفسه دون أي تدخّل لضمان سلاسته)
  //  - سحبة أفقية فعلية (تُنقِّل الصفحة ثم تمنع "نقرة الشبح" التي قد تعقبها)
  // ملاحظة تقنية: التتبّع أثناء السحبة يتم عبر مستمعين مؤقّتين على document (يُضافان عند
  // pointerdown ويُزالان فور انتهاء السحبة) بدل setPointerCapture، حتى يستمر التتبّع بشكل
  // صحيح حتى لو خرج الإصبع/المؤشر من حدود الصورة أثناء السحب، دون أي كلفة أداء دائمة.
  (function setupPageSwipeNavigation() {
    const wrap = el.pageImageWrap;
    const MIN_SWIPE_DISTANCE = 42; // أقل مسافة أفقية (px) لاعتبار الحركة سحبة تنقّل فعلية
    const MAX_OFF_AXIS = 65;       // أقصى انحراف رأسي مسموح به لتبقى الحركة أفقية بوضوح
    const AXIS_LOCK_DISTANCE = 10; // مسافة صغيرة تكفي لتحديد اتجاه الحركة أفقي/رأسي

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let axis = null; // "x" أفقي مؤكَّد، "y" رأسي مؤكَّد، null لم يُحسم بعد
    let suppressNextClick = false;

    function onMove(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === null && (Math.abs(dx) > AXIS_LOCK_DISTANCE || Math.abs(dy) > AXIS_LOCK_DISTANCE)) {
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      // نمنع التمرير الافتراضي فقط بعد التأكّد أن الحركة أفقية بوضوح، حتى لا نُعطِّل
      // التمرير الرأسي الطبيعي للصفحة في أي لحظة أخرى (راجع أيضًا touch-action في CSS)
      if (axis === "x" && e.cancelable) e.preventDefault();
    }

    function onUp(e) {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const isSwipe = axis === "x" && Math.abs(dx) >= MIN_SWIPE_DISTANCE && Math.abs(dy) <= MAX_OFF_AXIS;
      cleanup();
      if (isSwipe) {
        suppressNextClick = true;
        goToAdjacentPage(dx < 0 ? 1 : -1); // سحب لليسار → الصفحة التالية، لليمين → السابقة
      }
    }

    function onCancel() { cleanup(); }

    function cleanup() {
      pointerId = null;
      axis = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    }

    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (state.queue) return; // القائمة لا تدعم هذا التنقّل، ولها أزرارها الخاصة أصلاً
      if (e.target.closest(".error-mark")) return; // اترك التعامل مع علامات الأخطاء لمتحكّمها الخاص
      if (e.target.closest(".floating-mistake-card") || e.target.closest(".mistake-card-indicator")) return; // بطاقات الأخطاء الذكية (جديد) — لها سحب/نقر خاص بها
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      axis = null;
      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    // طبقة حماية إضافية: يمنع سحب الصورة الأصلي بالمتصفح (يظهر عادة عند السحب بالفأرة على
    // <img>)، لأنه كان يُلغي تسلسل أحداث المؤشر بالكامل (pointercancel) ويوقف السحبة فورًا.
    wrap.addEventListener("dragstart", (e) => e.preventDefault());

    // يمنع "نقرة شبح" (فتح تكبير الصورة أو وضع علامة خطأ) قد تُطلَق عادة عقب سحبة فعلية تمّت للتو
    wrap.addEventListener("click", (e) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  })();

  el.pageInput.addEventListener("change", () => {
    if (state.mode !== "page") return;
    const v = parseInt(el.pageInput.value, 10);
    if (!isNaN(v)) loadPage(v);
  });

  el.speedRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".speed-chip");
    if (!btn) return;
    document.querySelectorAll(".speed-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.playbackRate = parseFloat(btn.dataset.speed);
    state.audio.playbackRate = state.playbackRate;
  });

  el.repeatRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".repeat-chip");
    if (!btn) return;
    document.querySelectorAll(".repeat-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const val = btn.dataset.repeat;
    state.repeatTarget = val === "infinite" ? Infinity : parseInt(val, 10);
    state.repeatDone = 0;
    updateRepeatInfo();
  });

  el.pageImageWrap.addEventListener("click", () => {
    if (el.pageImage.classList.contains("hidden")) return;
    if (mainMarkController.isActive()) return; // المتحكّم يتولى النقر بنفسه في هذه الحالة
    el.lightboxImg.src = el.pageImage.src;
    el.lightbox.classList.remove("hidden");
  });
  el.pageImageWrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") el.pageImageWrap.click();
  });
  el.lightbox.addEventListener("click", () => {
    el.lightbox.classList.add("hidden");
    el.lightboxImg.removeAttribute("src");
  });

  // ===== ربط الأحداث: علامات مواضع الأخطاء =====
  // (تفعيل/تعطيل وضع العلامة على الشاشة الرئيسية مربوط داخليًا عبر mainMarkController)
  el.errorStatsBtn.addEventListener("click", openErrorStatsModal);
  el.closeErrorStatsModal.addEventListener("click", () => el.errorStatsModal.classList.add("hidden"));
  el.errorStatsModal.addEventListener("click", (e) => {
    if (e.target === el.errorStatsModal) el.errorStatsModal.classList.add("hidden");
  });

  // ===== ربط الأحداث: بطاقات الأخطاء الذكية (جديد) =====
  el.createMistakeCardBtn.addEventListener("click", () => {
    openMistakeCardModal({ mode: "create", page: state.currentPage });
  });
  el.mistakeCardIndicator.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.mc.openFloating && state.mc.openFloating.page === state.currentPage) closeFloatingCards();
    else openFloatingCardsForPage(state.currentPage);
  });
  el.mistakeCardIndicator.addEventListener("pointerdown", (e) => e.stopPropagation());

  // نافذة الإنشاء/التعديل
  el.closeCreateMistakeCardModal.addEventListener("click", () => el.createMistakeCardModal.classList.add("hidden"));
  el.mcCancelBtn.addEventListener("click", () => el.createMistakeCardModal.classList.add("hidden"));
  el.createMistakeCardModal.addEventListener("click", (e) => {
    if (e.target === el.createMistakeCardModal) el.createMistakeCardModal.classList.add("hidden");
  });
  el.mcAyahSelect.addEventListener("change", onMcAyahSelectChange);
  el.mcAyahText.addEventListener("input", () => {
    if (el.mcAyahText.value !== state.mc.autoFilledText) state.mc.autoFilledText = null;
    renderWordPicker();
  });
  el.mcSaveBtn.addEventListener("click", saveMistakeCardFromModal);

  // نافذة إدارة بطاقات الأخطاء
  el.mistakeCardsBtn.addEventListener("click", openMistakeCardsModal);
  el.closeMistakeCardsModal.addEventListener("click", () => el.mistakeCardsModal.classList.add("hidden"));
  el.mistakeCardsModal.addEventListener("click", (e) => {
    if (e.target === el.mistakeCardsModal) el.mistakeCardsModal.classList.add("hidden");
  });
  let mcSearchDebounceTimer = null;
  el.mcSearchInput.addEventListener("input", () => {
    clearTimeout(mcSearchDebounceTimer);
    mcSearchDebounceTimer = setTimeout(renderMistakeCardsList, 150);
  });
  el.mcFilterScope.addEventListener("change", renderMistakeCardsList);
  el.mcSortSelect.addEventListener("change", renderMistakeCardsList);
  el.mcShowMasteredToggle.addEventListener("change", renderMistakeCardsList);

  // نافذة "راجع أخطائي"
  el.reviewMistakesBtn.addEventListener("click", openReviewMistakesModal);
  el.closeReviewMistakesModal.addEventListener("click", () => el.reviewMistakesModal.classList.add("hidden"));
  el.reviewMistakesModal.addEventListener("click", (e) => {
    if (e.target === el.reviewMistakesModal) el.reviewMistakesModal.classList.add("hidden");
  });
  el.reviewStartBtn.addEventListener("click", startReviewSession);
  el.reviewMasteredBtn.addEventListener("click", () => answerReviewCard(true));
  el.reviewStillWrongBtn.addEventListener("click", () => answerReviewCard(false));
  el.reviewCloseAfterDoneBtn.addEventListener("click", () => el.reviewMistakesModal.classList.add("hidden"));
  el.reviewViewPageBtn.addEventListener("click", () => {
    const card = state.mc.reviewQueue[state.mc.reviewIndex];
    if (!card) return;
    el.lightboxImg.src = pageImageSrc(card.page);
    el.lightbox.classList.remove("hidden");
  });

  // نافذة إحصائيات بطاقات الأخطاء
  el.mistakeStatsBtn.addEventListener("click", openMistakeStatsModal);
  el.closeMistakeStatsModal.addEventListener("click", () => el.mistakeStatsModal.classList.add("hidden"));
  el.mistakeStatsModal.addEventListener("click", (e) => {
    if (e.target === el.mistakeStatsModal) el.mistakeStatsModal.classList.add("hidden");
  });

  // ===== ربط الأحداث: قائمة الاستماع =====
  el.playlistBtn.addEventListener("click", openPlaylistModal);
  el.closePlaylistModal.addEventListener("click", () => { stopPreview(); el.playlistModal.classList.add("hidden"); });
  el.playlistModal.addEventListener("click", (e) => {
    if (e.target === el.playlistModal) { stopPreview(); el.playlistModal.classList.add("hidden"); }
  });
  el.clearPlaylistBtn.addEventListener("click", () => {
    state.playlistSelection = [];
    refreshPlaylistBadges();
    updatePlaylistFooter();
  });
  el.startPlaylistBtn.addEventListener("click", () => {
    if (state.playlistSelection.length === 0) return;
    const items = state.playlistSelection.slice();
    stopPreview();
    el.playlistModal.classList.add("hidden");
    startQueue(items);
  });

  el.queuePrevBtn.addEventListener("click", () => { if (state.queue) playQueueItem(state.queue.index - 1); });
  el.queueNextBtn.addEventListener("click", () => { if (state.queue) playQueueItem(state.queue.index + 1); });
  el.queueStopBtn.addEventListener("click", exitQueueToNormalView);

  // ===== ربط الأحداث: اختبار ترتيب السور =====
  el.quizBtn.addEventListener("click", () => {
    el.quizModal.classList.remove("hidden");
    startQuiz();
  });
  el.closeQuizModal.addEventListener("click", () => el.quizModal.classList.add("hidden"));
  el.quizModal.addEventListener("click", (e) => {
    if (e.target === el.quizModal) el.quizModal.classList.add("hidden");
  });
  el.quizStartBtn.addEventListener("click", startQuiz);
  el.quizJuzSelect.addEventListener("change", startQuiz);
  el.quizResetBtn.addEventListener("click", startQuiz);
  el.quizCheckBtn.addEventListener("click", checkQuiz);

  // ===== ربط الأحداث: اختبار حفظ الأحزاب =====
  el.hizbTestBtn.addEventListener("click", openHizbTestModal);
  el.closeHizbTestModal.addEventListener("click", () => {
    stopHizbTestRecordingIfActive();
    el.hizbTestModal.classList.add("hidden");
  });
  el.hizbTestModal.addEventListener("click", (e) => {
    if (e.target === el.hizbTestModal) {
      stopHizbTestRecordingIfActive();
      el.hizbTestModal.classList.add("hidden");
    }
  });
  el.hizbTestSelect.addEventListener("change", updateHizbTestCoverage);
  el.hizbTestStartBtn.addEventListener("click", startHizbTestAttempt);
  el.hizbAnswerRecordBtn.addEventListener("click", startHizbAnswerRecording);
  el.hizbAnswerStopBtn.addEventListener("click", stopHizbAnswerRecording);
  el.hizbTestNextBtn.addEventListener("click", goToNextHizbTestQuestion);
  el.hizbTestSkipBtn.addEventListener("click", skipHizbTestQuestion);
  el.hizbTestViewPageBtn.addEventListener("click", () => {
    const t = state.hizbTest;
    const q = t.questions[t.index];
    if (!q) return;
    const pageNum = q.type === "page" || q.type === "surah" ? q.fromPage : q.page;
    el.lightboxImg.src = pageImageSrc(pageNum);
    el.lightbox.classList.remove("hidden");
  });
  el.hizbTestEndEarlyBtn.addEventListener("click", endHizbTestEarly);
  el.hizbTestNewAttemptBtn.addEventListener("click", () => {
    el.hizbTestReview.classList.add("hidden");
    el.hizbTestSetup.classList.remove("hidden");
    updateHizbTestCoverage();
  });

  // ===== ربط الأحداث: حالة الحفظ =====
  el.reminderBtn.addEventListener("click", openReminderModal);
  el.closeReminderModal.addEventListener("click", () => el.reminderModal.classList.add("hidden"));
  el.reminderModal.addEventListener("click", (e) => {
    if (e.target === el.reminderModal) el.reminderModal.classList.add("hidden");
  });

  // ===== ربط الأحداث: سجل التقدّم الصوتي =====
  el.progressLogBtn.addEventListener("click", openProgressLogModal);
  el.closeProgressLogModal.addEventListener("click", () => { stopHistoryPreview(); el.progressLogModal.classList.add("hidden"); });
  el.progressLogModal.addEventListener("click", (e) => {
    if (e.target === el.progressLogModal) { stopHistoryPreview(); el.progressLogModal.classList.add("hidden"); }
  });
  el.compareOldestNewestBtn.addEventListener("click", async () => {
    const { type, id } = state.recordTarget;
    try {
      const history = await QuranDB.getHistoryForTarget(type, id);
      compareOldestNewest(history);
    } catch (e) {
      showToast("تعذّر تشغيل المقارنة");
    }
  });

  // منع فقدان تسجيل جارٍ عند إغلاق الصفحة
  window.addEventListener("beforeunload", (e) => {
    const recording = isMainRecordingActive() ||
      (state.testMediaRecorder && state.testMediaRecorder.state === "recording");
    if (recording) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ===== تسجيل Service Worker للعمل بدون إنترنت =====
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* يعمل التطبيق محليًا حتى لو فشل تسجيل الـ Service Worker */
      });
    });
    // عند نشر تحديث جديد للتطبيق، يتولى الإصدار الجديد التحكم تلقائيًا —
    // نعيد تحميل الصفحة مرّة واحدة فقط لضمان وصول كل الإصلاحات فورًا
    // بدل بقاء نسخة قديمة مخزَّنة تعمل بصمت حتى تحديث يدوي لاحق.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  }

  // ===== تنبيه فتح التطبيق كملف مباشر (file://) =====
  // معظم مشاكل قائمة الاستماع واختبار حفظ الأحزاب التي قد تظهر سببها هذا تحديدًا
  const FILE_WARNING_DISMISSED_KEY = "quran-file-warning-dismissed";
  if (window.location.protocol === "file:") {
    let dismissed = false;
    try { dismissed = localStorage.getItem(FILE_WARNING_DISMISSED_KEY) === "1"; } catch (e) { /* تجاهل */ }
    if (!dismissed) el.fileProtocolWarning.classList.remove("hidden");
  }
  el.dismissFileWarning.addEventListener("click", () => {
    el.fileProtocolWarning.classList.add("hidden");
    try { localStorage.setItem(FILE_WARNING_DISMISSED_KEY, "1"); } catch (e) { /* تجاهل */ }
  });

  // ===== البدء =====
  loadSurahOverrides();
  populateSurahSelect();
  populateHizbSelect(el.hizbSelect);
  populateHizbTestSelect();
  populateQuizJuzSelect();

  let startMode = "page";
  try {
    const m = localStorage.getItem("quran-last-mode");
    if (m === "surah" || m === "hizb") startMode = m;
  } catch (e) { /* تجاهل */ }
  setModeUI(startMode);

  if (startMode === "surah") {
    let startSurah = 1;
    try {
      const s = parseInt(localStorage.getItem("quran-last-surah"), 10);
      if (!isNaN(s) && s >= 1 && s <= 114) startSurah = s;
    } catch (e) { /* تجاهل */ }
    loadSurah(startSurah);
  } else if (startMode === "hizb") {
    let startHizb = 1;
    try {
      const h = parseInt(localStorage.getItem("quran-last-hizb"), 10);
      if (!isNaN(h) && h >= 1 && h <= 60) startHizb = h;
    } catch (e) { /* تجاهل */ }
    loadHizb(startHizb);
  } else {
    let startPage = 1;
    try {
      const saved = parseInt(localStorage.getItem("quran-last-page"), 10);
      if (!isNaN(saved) && saved >= 1 && saved <= TOTAL_PAGES) startPage = saved;
    } catch (e) { /* تجاهل */ }
    loadPage(startPage);
  }
})();
