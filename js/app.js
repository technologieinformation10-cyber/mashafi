/**
 * app.js — منطق تطبيق مراجعة وحفظ القرآن
 * يعمل بالكامل محليًا بدون إنترنت. التسجيلات تُحفظ في IndexedDB
 * عبر db.js وتُشغَّل من نفس الجهاز حتى بعد إغلاق التطبيق.
 *
 * ثلاث طبقات تسجيل/تشغيل:
 *  - وضع "صفحة": تسجيل مستقل لكل صفحة (كالسابق).
 *  - وضع "سورة كاملة": تسجيل متصل واحد يغطي كل صفحات السورة، مع إمكانية
 *    تقليب الصفحات أثناء التسجيل دون قطعه.
 *  - "قائمة الاستماع": اختيار عدة مقاطع (صفحات و/أو سور مسجّلة) وتشغيلها
 *    الواحد تلو الآخر تلقائيًا بترتيب الاختيار.
 */

(() => {
  "use strict";

  const TOTAL_PAGES = 604;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 62; // نفس نصف قطر دائرة الـ SVG

  // ===== عناصر DOM =====
  const el = {
    modeTabs: document.getElementById("modeTabs"),
    modePageBtn: document.getElementById("modePageBtn"),
    modeSurahBtn: document.getElementById("modeSurahBtn"),

    pageNav: document.getElementById("pageNav"),
    pageInput: document.getElementById("pageInput"),
    pagePicker: document.getElementById("pagePicker"),
    surahPicker: document.getElementById("surahPicker"),
    surahSelect: document.getElementById("surahSelect"),
    surahRange: document.getElementById("surahRange"),
    surahRangeControls: document.getElementById("surahRangeControls"),
    surahShrinkBtn: document.getElementById("surahShrinkBtn"),
    surahExtendBtn: document.getElementById("surahExtendBtn"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageNumberLabel: document.getElementById("pageNumberLabel"),
    recordedBadge: document.getElementById("recordedBadge"),

    pageImageWrap: document.getElementById("pageImageWrap"),
    pageImage: document.getElementById("pageImage"),
    pageImagePlaceholder: document.getElementById("pageImagePlaceholder"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightboxImg"),

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
  };

  // ===== الحالة =====
  const state = {
    mode: "page", // "page" | "surah"
    currentPage: 1,
    currentSurah: null, // عنصر من QURAN_SURAHS عند وضع السورة
    recordTarget: { type: "page", id: 1 },

    mediaRecorder: null,
    chunks: [],
    recordStartTime: 0,
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

    playlistSelection: [], // [{type:'page'|'surah', id, label}] بترتيب الاختيار
    quiz: { juz: null, correctOrder: [], sequence: [], checked: false },
    queue: null, // { items: [...], index }
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

  function pageImageSrc(pageNum) {
    return `page-${pageNum}.jpg`;
  }

  function loadPageImage(pageNum) {
    const src = pageImageSrc(pageNum);
    const tester = new Image();
    tester.onload = () => {
      if (state.currentPage !== pageNum) return;
      el.pageImage.src = src;
      el.pageImage.classList.remove("hidden");
      el.pageImagePlaceholder.classList.add("hidden");
      el.pageImageWrap.classList.add("has-image");
    };
    tester.onerror = () => {
      if (state.currentPage !== pageNum) return;
      el.pageImage.classList.add("hidden");
      el.pageImage.removeAttribute("src");
      el.pageImagePlaceholder.classList.remove("hidden");
      el.pageImageWrap.classList.remove("has-image");
    };
    tester.src = src;
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

  async function downloadRecordingFor(type, id, label) {
    const rec = type === "surah" ? await QuranDB.getSurahRecording(id) : await QuranDB.getRecording(id);
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

  // ===== اختبار ترتيب السور في كل جزء =====
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

    // منطقة التسلسل الذي بناه المستخدم
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

    // مجموعة السور المتبقية (لم تُختر بعد)
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

  // يطبّق أي تصحيحات حفظها المستخدم سابقًا لحدود بعض السور (صفحة النهاية)
  // فوق البيانات الافتراضية في surahs.js، لأن بعض السور قد تمتد فعليًا
  // لصفحة إضافية مقارنةً بما هو مُدخل مسبقًا.
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

  // ===== تحديث الصوت من سجل محفوظ (صفحة أو سورة) =====
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

  // ===== تبديل الوضع (صفحة / سورة) =====
  function setModeUI(mode) {
    state.mode = mode;
    el.modePageBtn.classList.toggle("active", mode === "page");
    el.modeSurahBtn.classList.toggle("active", mode === "surah");
    el.pagePicker.classList.toggle("hidden", mode !== "page");
    el.surahPicker.classList.toggle("hidden", mode !== "surah");
    el.surahRange.classList.toggle("hidden", mode !== "surah");
    el.surahRangeControls.classList.toggle("hidden", mode !== "surah");
    el.surahRecordHint.classList.toggle("hidden", mode !== "surah");
    el.recordBtnText.textContent = mode === "surah" ? "تسجيل السورة كاملة" : "تسجيل الصفحة";
    try { localStorage.setItem("quran-last-mode", mode); } catch (e) { /* تجاهل */ }
  }

  // ===== تحميل صفحة (وضع الصفحة) =====
  async function loadPage(pageNum) {
    pageNum = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
    stopQueueIfActive();
    stopPlayback();
    stopRecordingIfActive(true);

    state.mode = "page";
    state.currentSurah = null;
    state.currentPage = pageNum;
    state.recordTarget = { type: "page", id: pageNum };

    el.pageInput.value = pageNum;
    el.pageNumberLabel.textContent = "الصفحة " + pageNum;

    try { localStorage.setItem("quran-last-page", String(pageNum)); } catch (e) { /* تجاهل */ }

    loadPageImage(pageNum);

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

  function updateSurahRangeButtonsState() {
    if (!state.currentSurah) return;
    const surah = state.currentSurah;
    el.surahShrinkBtn.disabled = surah.endPage <= surah.startPage;
    el.surahExtendBtn.disabled = surah.endPage >= TOTAL_PAGES;
  }

  // تصحيح يدوي لحدود السورة: عند مراجعة صور المصحف قد يتبيّن أن السورة
  // تمتد فعليًا لصفحة إضافية (حتى لو جزءًا صغيرًا منها) قبل بداية السورة
  // التالية، أو العكس. يُحفظ التصحيح محليًا ليبقى بعد إعادة فتح التطبيق.
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

  // تقليب صفحات داخل السورة الحالية دون قطع التسجيل أو التشغيل الجاري
  function flipSurahPage(delta) {
    if (!state.currentSurah) return;
    const target = state.currentPage + delta;
    if (target < state.currentSurah.startPage || target > state.currentSurah.endPage) return;
    state.currentPage = target;
    el.pageNumberLabel.textContent = `سورة ${state.currentSurah.name} — صفحة ${target}`;
    loadPageImage(target);
  }

  // ===== التسجيل =====
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
      const duration = (Date.now() - state.recordStartTime) / 1000;
      if (target.type === "surah") {
        await QuranDB.saveSurahRecording(target.id, blob, duration);
        showToast("تم حفظ تسجيل السورة كاملة");
      } else {
        await QuranDB.saveRecording(target.id, blob, duration);
        showToast("تم حفظ التسجيل");
      }
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
      if (target.type === "surah") loadSurah(target.id);
      else loadPage(target.id);
    };

    state.mediaRecorder.start();
    state.recordStartTime = Date.now();

    el.recordBtn.classList.add("hidden");
    el.stopRecordBtn.classList.remove("hidden");
    el.recTimer.classList.remove("hidden");
    el.playBtn.disabled = true;
    el.deleteBtn.disabled = true;
    el.modePageBtn.disabled = true;
    el.modeSurahBtn.disabled = true;
    el.surahSelect.disabled = true;
    el.pageInput.disabled = true;
    el.playlistBtn.disabled = true;

    state.recordTimerHandle = setInterval(() => {
      const elapsed = (Date.now() - state.recordStartTime) / 1000;
      el.recTimer.textContent = formatTime(elapsed);
    }, 200);
  }

  function stopRecordingIfActive(silent) {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      if (silent) {
        state.mediaRecorder.onstop = () => {
          state.stream && state.stream.getTracks().forEach((t) => t.stop());
        };
      }
      state.mediaRecorder.stop();
    }
    clearInterval(state.recordTimerHandle);
    el.recordBtn.classList.remove("hidden");
    el.stopRecordBtn.classList.add("hidden");
    el.recTimer.classList.add("hidden");
    el.modePageBtn.disabled = false;
    el.modeSurahBtn.disabled = false;
    el.surahSelect.disabled = false;
    el.pageInput.disabled = false;
    el.playlistBtn.disabled = false;
  }

  function stopRecording() {
    stopRecordingIfActive(false);
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
    const [pageNums, surahNums] = await Promise.all([
      QuranDB.getAllPageNumbers(),
      QuranDB.getAllSurahNumbers(),
    ]);
    pageNums.sort((a, b) => a - b);
    surahNums.sort((a, b) => a - b);
    renderPlaylistBody(pageNums, surahNums);
    el.playlistModal.classList.remove("hidden");
  }

  function renderPlaylistBody(pageNums, surahNums) {
    el.playlistBody.innerHTML = "";
    if (pageNums.length === 0 && surahNums.length === 0) {
      const p = document.createElement("p");
      p.className = "playlist-empty";
      p.textContent = "لا توجد تسجيلات محفوظة بعد. سجّل بعض الصفحات أو السور أولًا.";
      el.playlistBody.appendChild(p);
      updatePlaylistFooter();
      return;
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

  function selectionOrderOf(type, id) {
    const idx = state.playlistSelection.findIndex((it) => it.type === type && it.id === id);
    return idx === -1 ? null : idx + 1;
  }

  function makePlaylistItem(type, id, label) {
    const wrap = document.createElement("div");
    wrap.className = "playlist-item-row";

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

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "playlist-item-download";
    dlBtn.setAttribute("aria-label", `تحميل/إرسال تسجيل ${label}`);
    dlBtn.innerHTML = downloadIconSVG();
    dlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      downloadRecordingFor(type, id, label);
    });

    wrap.appendChild(row);
    wrap.appendChild(dlBtn);
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

  function finishQueue() {
    showToast("انتهت قائمة الاستماع");
    const wasSurah = state.mode === "surah" && state.currentSurah;
    const surahNum = wasSurah ? state.currentSurah.number : null;
    const pageNum = state.currentPage;
    stopQueueIfActive();
    if (wasSurah) loadSurah(surahNum);
    else loadPage(pageNum);
  }

  function exitQueueToNormalView() {
    const wasSurah = state.mode === "surah" && state.currentSurah;
    const surahNum = wasSurah ? state.currentSurah.number : null;
    const pageNum = state.currentPage;
    stopQueueIfActive();
    if (wasSurah) loadSurah(surahNum);
    else loadPage(pageNum);
  }

  // ===== ربط الأحداث: التبديل بين الأوضاع =====
  el.modePageBtn.addEventListener("click", () => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      showToast("أوقف التسجيل الحالي أولًا");
      return;
    }
    if (state.mode === "page") return;
    setModeUI("page");
    loadPage(state.currentPage);
  });

  el.modeSurahBtn.addEventListener("click", () => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      showToast("أوقف التسجيل الحالي أولًا");
      return;
    }
    if (state.mode === "surah") return;
    setModeUI("surah");
    const n = state.currentSurah ? state.currentSurah.number : surahForPage(state.currentPage).number;
    loadSurah(n);
  });

  el.surahSelect.addEventListener("change", () => {
    const n = parseInt(el.surahSelect.value, 10);
    if (!isNaN(n)) loadSurah(n);
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
    if (state.queue) {
      // إعادة السماح بالتشغيل اليدوي للمقطع الحالي بدل قفزه تلقائيًا
    }
  });

  el.seekBar.addEventListener("input", () => {
    state.audio.currentTime = parseFloat(el.seekBar.value);
  });

  el.recordBtn.addEventListener("click", startRecording);
  el.stopRecordBtn.addEventListener("click", stopRecording);

  el.deleteBtn.addEventListener("click", async () => {
    const isSurah = state.recordTarget.type === "surah";
    const label = isSurah && state.currentSurah ? `سورة ${state.currentSurah.name}` : `صفحة ${state.currentPage}`;
    if (!confirm(`هل تريد حذف تسجيل ${label} نهائيًا؟`)) return;
    if (isSurah) {
      await QuranDB.deleteSurahRecording(state.recordTarget.id);
      showToast("تم حذف تسجيل السورة");
      loadSurah(state.recordTarget.id);
    } else {
      await QuranDB.deleteRecording(state.recordTarget.id);
      showToast("تم حذف التسجيل");
      loadPage(state.recordTarget.id);
    }
  });

  el.downloadBtn.addEventListener("click", async () => {
    if (!state.hasRecording || !state.currentObjectUrl) return;
    const type = state.recordTarget.type;
    const id = state.recordTarget.id;
    const label = type === "surah" && state.currentSurah ? `سورة ${state.currentSurah.name}` : `صفحة ${id}`;
    const filename = buildRecordingFileName(type, id, state.currentRecMime);
    // نجلب التسجيل من قاعدة البيانات مباشرةً (بدل الاعتماد على رابط التشغيل الحالي فقط)
    // لضمان الحصول على كائن Blob صالح للمشاركة عبر واتساب أو غيره.
    const rec = type === "surah" ? await QuranDB.getSurahRecording(id) : await QuranDB.getRecording(id);
    if (!rec || !rec.blob) {
      showToast("لا يوجد تسجيل لتحميله");
      return;
    }
    await shareOrDownloadBlob(rec.blob, filename, label);
  });

  // ===== ربط الأحداث: التنقل بين الصفحات =====
  el.prevPage.addEventListener("click", () => {
    // زر اليمين = الصفحة السابقة (الرقم الأصغر)
    if (state.mode === "surah") flipSurahPage(-1);
    else loadPage(state.currentPage - 1);
  });
  el.nextPage.addEventListener("click", () => {
    // زر اليسار = الصفحة التالية (الرقم الأكبر)
    if (state.mode === "surah") flipSurahPage(1);
    else loadPage(state.currentPage + 1);
  });

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

  // ===== ربط الأحداث: قائمة الاستماع =====
  el.playlistBtn.addEventListener("click", openPlaylistModal);
  el.closePlaylistModal.addEventListener("click", () => el.playlistModal.classList.add("hidden"));
  el.playlistModal.addEventListener("click", (e) => {
    if (e.target === el.playlistModal) el.playlistModal.classList.add("hidden");
  });
  el.clearPlaylistBtn.addEventListener("click", () => {
    state.playlistSelection = [];
    refreshPlaylistBadges();
    updatePlaylistFooter();
  });
  el.startPlaylistBtn.addEventListener("click", () => {
    if (state.playlistSelection.length === 0) return;
    const items = state.playlistSelection.slice();
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
  el.quizResetBtn.addEventListener("click", startQuiz);
  el.quizCheckBtn.addEventListener("click", checkQuiz);

  // منع فقدان تسجيل جارٍ عند إغلاق الصفحة
  window.addEventListener("beforeunload", (e) => {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
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
  }

  // ===== البدء =====
  loadSurahOverrides();
  populateSurahSelect();
  populateQuizJuzSelect();

  let startMode = "page";
  try {
    const m = localStorage.getItem("quran-last-mode");
    if (m === "surah") startMode = "surah";
  } catch (e) { /* تجاهل */ }
  setModeUI(startMode);

  if (startMode === "surah") {
    let startSurah = 1;
    try {
      const s = parseInt(localStorage.getItem("quran-last-surah"), 10);
      if (!isNaN(s) && s >= 1 && s <= 114) startSurah = s;
    } catch (e) { /* تجاهل */ }
    loadSurah(startSurah);
  } else {
    let startPage = 1;
    try {
      const saved = parseInt(localStorage.getItem("quran-last-page"), 10);
      if (!isNaN(saved) && saved >= 1 && saved <= TOTAL_PAGES) startPage = saved;
    } catch (e) { /* تجاهل */ }
    loadPage(startPage);
  }
})();
