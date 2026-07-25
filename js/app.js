/**
 * app.js — منطق تطبيق مراجعة وحفظ القرآن
 * يعمل بالكامل محليًا بدون إنترنت. التسجيلات تُحفظ في IndexedDB
 * عبر db.js وتُشغَّل من نفس الجهاز حتى بعد إغلاق التطبيق.
 */

(() => {
  "use strict";

  const TOTAL_PAGES = 604;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 62; // نفس نصف قطر دائرة الـ SVG

  // ===== عناصر DOM =====
  const el = {
    pageInput: document.getElementById("pageInput"),
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

    recordBtn: document.getElementById("recordBtn"),
    stopRecordBtn: document.getElementById("stopRecordBtn"),
    recTimer: document.getElementById("recTimer"),

    stopBtn: document.getElementById("stopBtn"),
    deleteBtn: document.getElementById("deleteBtn"),

    speedRow: document.getElementById("speedRow"),
    repeatRow: document.getElementById("repeatRow"),

    toast: document.getElementById("toast"),
  };

  // ===== الحالة =====
  const state = {
    currentPage: 1,
    mediaRecorder: null,
    chunks: [],
    recordStartTime: 0,
    recordTimerHandle: null,
    stream: null,

    audio: new Audio(),
    currentObjectUrl: null,
    hasRecordingOnPage: false,

    playbackRate: 1,
    repeatTarget: 1, // رقم أو Infinity
    repeatDone: 0,
    isPlaying: false,
  };

  state.audio.preservesPitch = true;
  state.audio.mozPreservesPitch = true;
  state.audio.webkitPreservesPitch = true;

  // ===== أدوات مساعدة =====
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  // مسار صورة صفحة المصحف حسب رقم الصفحة (page-1.jpg, page-2.jpg ...)
  function pageImageSrc(pageNum) {
    return `images/page-${pageNum}.jpg`;
  }

  function loadPageImage(pageNum) {
    const src = pageImageSrc(pageNum);
    const tester = new Image();
    tester.onload = () => {
      if (state.currentPage !== pageNum) return; // تجاهل إن تغيّرت الصفحة أثناء التحميل
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

  // ===== تحميل صفحة =====
  async function loadPage(pageNum) {
    pageNum = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
    stopPlayback();
    stopRecordingIfActive(true);

    state.currentPage = pageNum;
    el.pageInput.value = pageNum;
    el.pageNumberLabel.textContent = "الصفحة " + pageNum;

    try { localStorage.setItem("quran-last-page", String(pageNum)); } catch (e) { /* تجاهل إن كان التخزين غير متاح */ }

    loadPageImage(pageNum);

    if (state.currentObjectUrl) {
      URL.revokeObjectURL(state.currentObjectUrl);
      state.currentObjectUrl = null;
    }

    const rec = await QuranDB.getRecording(pageNum);
    if (rec && rec.blob) {
      state.hasRecordingOnPage = true;
      state.currentObjectUrl = URL.createObjectURL(rec.blob);
      state.audio.src = state.currentObjectUrl;
      el.recordedBadge.classList.remove("hidden");
      el.playBtn.disabled = false;
      el.deleteBtn.disabled = false;
    } else {
      state.hasRecordingOnPage = false;
      state.audio.removeAttribute("src");
      el.recordedBadge.classList.add("hidden");
      el.playBtn.disabled = true;
      el.deleteBtn.disabled = true;
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

  // ===== التسجيل =====
  async function startRecording() {
    if (state.isPlaying) stopPlayback();

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

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };

    state.mediaRecorder.onstop = async () => {
      const blob = new Blob(state.chunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
      const duration = (Date.now() - state.recordStartTime) / 1000;
      await QuranDB.saveRecording(state.currentPage, blob, duration);
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
      showToast("تم حفظ التسجيل");
      loadPage(state.currentPage);
    };

    state.mediaRecorder.start();
    state.recordStartTime = Date.now();

    el.recordBtn.classList.add("hidden");
    el.stopRecordBtn.classList.remove("hidden");
    el.recTimer.classList.remove("hidden");
    el.playBtn.disabled = true;
    el.deleteBtn.disabled = true;

    state.recordTimerHandle = setInterval(() => {
      const elapsed = (Date.now() - state.recordStartTime) / 1000;
      el.recTimer.textContent = formatTime(elapsed);
    }, 200);
  }

  function stopRecordingIfActive(silent) {
    if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
      if (silent) {
        // إلغاء بدون حفظ عند التنقل المفاجئ بين الصفحات
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
    if (!state.hasRecordingOnPage) return;
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
    }
  });

  // ===== ربط الأحداث =====
  el.playBtn.addEventListener("click", () => {
    if (state.isPlaying) pauseAudio();
    else playAudio();
  });

  el.stopBtn.addEventListener("click", stopPlayback);

  el.seekBar.addEventListener("input", () => {
    state.audio.currentTime = parseFloat(el.seekBar.value);
  });

  el.recordBtn.addEventListener("click", startRecording);
  el.stopRecordBtn.addEventListener("click", stopRecording);

  el.deleteBtn.addEventListener("click", async () => {
    if (!confirm("هل تريد حذف تسجيل هذه الصفحة نهائيًا؟")) return;
    await QuranDB.deleteRecording(state.currentPage);
    showToast("تم حذف التسجيل");
    loadPage(state.currentPage);
  });

  el.prevPage.addEventListener("click", () => loadPage(state.currentPage + 1)); // RTL: التالي بصريًا = زيادة الرقم
  el.nextPage.addEventListener("click", () => loadPage(state.currentPage - 1));

  el.pageInput.addEventListener("change", () => {
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
  let startPage = 1;
  try {
    const saved = parseInt(localStorage.getItem("quran-last-page"), 10);
    if (!isNaN(saved) && saved >= 1 && saved <= TOTAL_PAGES) startPage = saved;
  } catch (e) { /* تجاهل إن كان التخزين غير متاح */ }
  loadPage(startPage);
})();
