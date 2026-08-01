/**
 * global-player.js — مشغّل صوت عالمي (Global Audio Player) مستقل تمامًا عن
 * أي صفحة/سورة/حزب أو Widget أو Screen في التطبيق.
 *
 * الغرض: تشغيل التسجيلات المختارة من "قائمة الاستماع" (نافذة قائمة التسجيلات)
 * بحيث:
 *  - يستمر التشغيل حتى لو أغلق المستخدم النافذة أو تنقّل بين الصفحات/السور/الأحزاب.
 *  - لا يُعاد تحميل الملف الصوتي ولا يُعاد التشغيل من البداية أبدًا بسبب التنقّل.
 *  - تظهر شريحة تشغيل مصغّرة (Mini Player) ثابتة أسفل الشاشة في كل أنحاء التطبيق.
 *
 * هذا الملف مستقل بالكامل: يملك عنصر <audio> خاصًا به (منفصلاً تمامًا عن
 * state.audio في app.js الذي يبقى كما هو لتشغيل تسجيل الصفحة/السورة/الحزب
 * المعروضة حاليًا)، ولا يلمس أي متغيّر حالة خاص بالتنقّل أو بالتسجيل. يتبع نفس
 * أسلوب القائمة العامة (const باسم عام) المستخدم في db.js لسهولة الاستدعاء من
 * app.js دون أي وحدات (modules) أو استيراد.
 *
 * يعتمد فقط على:
 *  - QuranDB (من db.js) لجلب Blob التسجيل المطلوب.
 *  - window.QuranAppBridge (يُعرَّف في نهاية app.js) للوصول الآمن لدالة
 *    showToast ولإعداد "عدد مرات التكرار" الحالي — بلا أي اعتماد أعمق على
 *    app.js حتى لا يتأثر أي منهما بتغييرات الآخر.
 */

const GlobalPlayer = (() => {
  "use strict";

  const SPEEDS = [1, 1.25, 1.5, 1.75, 2];
  const SKIP_DELAY_MS = 700; // نفس مهلة تخطّي المقطع الفارغ المستخدمة سابقًا في قائمة الاستماع

  // ===== عناصر واجهة المشغّل المصغّر (قد لا تكون موجودة إن عُدِّل index.html يدويًا لاحقًا) =====
  const gel = {
    root: document.getElementById("miniPlayer"),
    label: document.getElementById("miniPlayerLabel"),
    queuePos: document.getElementById("miniPlayerQueuePos"),
    speedBtn: document.getElementById("miniPlayerSpeedBtn"),
    curTime: document.getElementById("miniPlayerCurTime"),
    durTime: document.getElementById("miniPlayerDurTime"),
    seek: document.getElementById("miniPlayerSeek"),
    prevBtn: document.getElementById("miniPlayerPrevBtn"),
    playBtn: document.getElementById("miniPlayerPlayBtn"),
    playIcon: document.getElementById("miniPlayerPlayIcon"),
    pauseIcon: document.getElementById("miniPlayerPauseIcon"),
    stopBtn: document.getElementById("miniPlayerStopBtn"),
    nextBtn: document.getElementById("miniPlayerNextBtn"),
  };
  const domReady = !!gel.root;

  function fetchRecordByType(type, id) {
    if (type === "surah") return QuranDB.getSurahRecording(id);
    if (type === "hizb") return QuranDB.getHizbRecording(id);
    return QuranDB.getRecording(id);
  }

  function notify(msg) {
    if (window.QuranAppBridge && typeof window.QuranAppBridge.showToast === "function") {
      window.QuranAppBridge.showToast(msg);
    }
  }

  // "عدد مرات التكرار" هو إعداد عام موجود مسبقًا في التطبيق (لكل مقطع، كما يقول
  // نصه في الواجهة) — نقرأه هنا فقط، دون أي تعديل على مصدره في app.js.
  function getRepeatTarget() {
    if (window.QuranAppBridge && typeof window.QuranAppBridge.getRepeatTarget === "function") {
      const v = window.QuranAppBridge.getRepeatTarget();
      if (v === Infinity || (typeof v === "number" && v >= 1)) return v;
    }
    return 1;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  // ===== الحالة الداخلية للمشغّل =====
  const player = {
    audio: new Audio(),
    items: [],   // [{type:'page'|'surah'|'hizb', id, label}, ...]
    index: -1,   // فهرس العنصر الحالي داخل items
    currentUrl: null,
    playbackRate: 1,
    repeatDone: 0,
    listeners: [], // دوال تُستدعى عند أي تغيّر في حالة المشغّل (لتزامن أيقونات نافذة القائمة)
  };
  player.audio.preservesPitch = true;
  player.audio.mozPreservesPitch = true;
  player.audio.webkitPreservesPitch = true;

  let loadToken = 0; // يمنع تعارض التحميلات إن ضغط المستخدم عدة عناصر بسرعة

  function currentItem() {
    return player.index >= 0 && player.index < player.items.length ? player.items[player.index] : null;
  }

  function isSameRef(item, type, id) {
    return !!item && item.type === type && item.id === id;
  }

  function safePlay() {
    const p = player.audio.play();
    if (p && typeof p.catch === "function") p.catch(() => { /* تجاهل رفض تشغيل نادر (سياسة متصفح) */ });
  }

  function emitChange() {
    for (const fn of player.listeners) {
      try { fn(); } catch (e) { /* لا نسمح لخطأ في مستمع واحد بإيقاف بقية المشغّل */ }
    }
    renderUI();
  }

  // ===== واجهة المستخدم (الشريط المصغّر) =====
  function renderUI() {
    if (!domReady) return;
    const item = currentItem();
    if (!item) {
      gel.root.classList.add("hidden");
      document.body.classList.remove("has-mini-player");
      return;
    }
    gel.root.classList.remove("hidden");
    document.body.classList.add("has-mini-player");
    gel.label.textContent = item.label;

    if (player.items.length > 1) {
      gel.queuePos.textContent = `${player.index + 1} / ${player.items.length}`;
      gel.queuePos.classList.remove("hidden");
      gel.prevBtn.classList.remove("hidden");
      gel.nextBtn.classList.remove("hidden");
      gel.prevBtn.disabled = player.index === 0;
      gel.nextBtn.disabled = player.index === player.items.length - 1;
    } else {
      gel.queuePos.classList.add("hidden");
      gel.prevBtn.classList.add("hidden");
      gel.nextBtn.classList.add("hidden");
    }

    gel.speedBtn.textContent = String(player.playbackRate) + "x";

    const playing = !player.audio.paused && !player.audio.ended;
    gel.playIcon.classList.toggle("hidden", playing);
    gel.pauseIcon.classList.toggle("hidden", !playing);
    gel.playBtn.setAttribute("aria-label", playing ? "إيقاف مؤقت" : "تشغيل");
  }

  // ===== تحميل وتشغيل عنصر بحسب فهرسه داخل القائمة =====
  async function loadIndex(i) {
    if (i < 0 || i >= player.items.length) return;
    const myToken = ++loadToken;
    player.index = i;
    player.repeatDone = 0;
    const item = player.items[i];

    if (player.currentUrl) { URL.revokeObjectURL(player.currentUrl); player.currentUrl = null; }
    renderUI(); // يظهر اسم المقطع الجديد فورًا حتى قبل اكتمال جلبه من قاعدة البيانات

    let rec = null;
    try {
      rec = await fetchRecordByType(item.type, item.id);
    } catch (err) {
      if (myToken !== loadToken) return; // استُبدل هذا الطلب بطلب أحدث أثناء الانتظار
      notify("تعذّر تحميل \u201c" + item.label + "\u201d — سيتم تخطّيه");
      advance(true);
      return;
    }
    if (myToken !== loadToken) return;

    if (!rec || !rec.blob) {
      notify("لا يوجد تسجيل لـ " + item.label + " — سيتم تخطّيه");
      advance(true);
      return;
    }

    const url = URL.createObjectURL(rec.blob);
    player.currentUrl = url;
    player.audio.src = url;
    player.audio.playbackRate = player.playbackRate;
    safePlay();
    emitChange();
  }

  function advance(skip) {
    const next = player.index + 1;
    if (next < player.items.length) {
      if (skip) setTimeout(() => loadIndex(next), SKIP_DELAY_MS);
      else loadIndex(next);
    } else {
      finish();
    }
  }

  function finish() {
    notify("انتهت قائمة الاستماع");
    hardStop();
  }

  function hardStop() {
    loadToken++; // يلغي أي تحميل قيد الانتظار
    player.audio.pause();
    player.audio.currentTime = 0;
    if (player.currentUrl) { URL.revokeObjectURL(player.currentUrl); player.currentUrl = null; }
    player.audio.removeAttribute("src");
    player.items = [];
    player.index = -1;
    player.repeatDone = 0;
    emitChange();
  }

  // ===== أحداث عنصر الصوت =====
  player.audio.addEventListener("loadedmetadata", () => {
    if (!domReady) return;
    gel.durTime.textContent = formatTime(player.audio.duration);
    gel.seek.max = player.audio.duration || 0;
  });
  player.audio.addEventListener("timeupdate", () => {
    if (!domReady) return;
    gel.curTime.textContent = formatTime(player.audio.currentTime);
    gel.seek.value = player.audio.currentTime;
  });
  player.audio.addEventListener("play", renderUI);
  player.audio.addEventListener("pause", renderUI);
  player.audio.addEventListener("ended", () => {
    player.repeatDone += 1;
    const target = getRepeatTarget();
    const shouldRepeat = target === Infinity || player.repeatDone < target;
    if (shouldRepeat) {
      player.audio.currentTime = 0;
      player.audio.playbackRate = player.playbackRate;
      safePlay();
    } else {
      player.repeatDone = 0;
      advance(false);
    }
  });

  // ===== الواجهة العامة =====

  // يبدأ تشغيل قائمة عناصر (واحد أو أكثر) بترتيبها — تُستخدم لكل من "▶ تشغيل
  // مباشر" لعنصر واحد و"تشغيل القائمة" لعدة عناصر مختارة.
  function playQueue(items) {
    if (!items || items.length === 0) return;
    player.items = items.slice();
    loadIndex(0);
  }

  // زر "▶/⏸" على عنصر واحد داخل نافذة القائمة: تبديل تشغيل/إيقاف مؤقت إن كان هو
  // العنصر الحالي بالفعل، أو بدء تشغيله من جديد إن كان عنصرًا مختلفًا.
  function toggleItem(type, id, label) {
    if (isSameRef(currentItem(), type, id)) {
      if (player.audio.paused) safePlay(); else player.audio.pause();
      emitChange();
      return;
    }
    playQueue([{ type, id, label }]);
  }

  // زر "🔁 إعادة": يعيد العنصر الحالي من البداية، أو يبدأ عنصرًا جديدًا إن اختلف.
  function replay(type, id, label) {
    if (isSameRef(currentItem(), type, id)) {
      player.audio.currentTime = 0;
      safePlay();
      emitChange();
      return;
    }
    playQueue([{ type, id, label }]);
  }

  // إيقاف كامل: يوقف الصوت، يصفّر الموضع، يخفي المشغّل المصغّر بالكامل، ويفرّغ
  // القائمة الحالية. هذا هو زر "إيقاف" في المشغّل المصغّر.
  function stop() {
    hardStop();
  }

  // يُستدعى من app.js عند حذف تسجيل من قائمة التسجيلات، حتى لا يبقى المشغّل
  // يشغّل (أو ينتظر تشغيل) تسجيلاً لم يعد موجودًا في قاعدة البيانات.
  function notifyDeleted(type, id) {
    if (isSameRef(currentItem(), type, id)) {
      notify("تم حذف هذا التسجيل — تم إيقاف التشغيل");
      hardStop();
      return;
    }
    const idx = player.items.findIndex((it) => it.type === type && it.id === id);
    if (idx > player.index) {
      player.items.splice(idx, 1);
      emitChange();
    }
  }

  function isCurrentItem(type, id) { return isSameRef(currentItem(), type, id); }
  function isPlayingItem(type, id) { return isCurrentItem(type, id) && !player.audio.paused; }

  function onChange(fn) {
    if (typeof fn === "function") player.listeners.push(fn);
  }

  // ===== ربط أزرار المشغّل المصغّر نفسه =====
  if (domReady) {
    gel.playBtn.addEventListener("click", () => {
      if (!currentItem()) return;
      if (player.audio.paused) safePlay(); else player.audio.pause();
    });
    gel.stopBtn.addEventListener("click", stop);
    gel.prevBtn.addEventListener("click", () => { if (player.index > 0) loadIndex(player.index - 1); });
    gel.nextBtn.addEventListener("click", () => { if (player.index < player.items.length - 1) loadIndex(player.index + 1); });
    gel.seek.addEventListener("input", () => {
      if (!currentItem()) return;
      player.audio.currentTime = parseFloat(gel.seek.value);
    });
    gel.speedBtn.addEventListener("click", () => {
      const i = SPEEDS.indexOf(player.playbackRate);
      player.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
      player.audio.playbackRate = player.playbackRate;
      renderUI();
    });
  }

  return { playQueue, toggleItem, replay, stop, notifyDeleted, isCurrentItem, isPlayingItem, onChange };
})();
