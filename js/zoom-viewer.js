/**
 * zoom-viewer.js — محرّك تكبير/تحريك مستقل (Pinch-to-zoom / Double-tap /
 * Pan) لأي عنصر "سطح تكبير" (zoom surface) داخل "منفذ عرض" (viewport) ثابت
 * الحجم. مستقل تمامًا عن بقية التطبيق: لا يعرف شيئًا عن الصفحات أو السور أو
 * علامات الأخطاء — فقط يطبّق `transform: translate3d(...) scale(...)` على
 * العنصر الممرَّر إليه، ويُخطر المستدعي بثلاثة أحداث فقط:
 *
 *   - onTap(clientX, clientY): نقرة واحدة نظيفة (بلا سحب) لم تتحوّل لنقرة
 *     مزدوجة. المستدعي حرّ في تجاهلها أو استخدامها (مثلاً لإضافة علامة خطأ).
 *   - onSwipeNav(direction): سحبة أفقية واضحة بإصبع واحد، ولا تكبير حاليًا
 *     (scale ≈ 1). direction تكون "left" أو "right" (اتجاه حركة الإصبع
 *     الفعلي على الشاشة؛ ترجمتها لصفحة تالية/سابقة متروكة للمستدعي، حتى يبقى
 *     هذا الملف بلا أي افتراض عن اتجاه القراءة).
 *   - onZoomChange(scale): كلما تغيّر مستوى التكبير (مفيد لتحديث نص تلميح أو
 *     إظهار/إخفاء عناصر بحسب حالة التكبير).
 *
 * لماذا لا تحتاج علامات الأخطاء لأي حساب موضع إضافي أثناء التكبير؟ لأنها —
 * بتصميم الكود الأصلي في app.js — تُبنى كعناصر مطلقة الموضع بالبكسل داخل طبقة
 * (errorMarksLayer) تكون هي نفسها من ضمن سطح التكبير الممرَّر هنا. تطبيق
 * transform واحد على السطح بأكمله يحرّك الصورة وطبقة العلامات معًا ككتلة
 * واحدة عبر GPU، فتبقى العلامات مثبَّتة بصريًا في مكانها الصحيح تلقائيًا بلا
 * أي إعادة حساب لكل علامة على حدة أثناء الحركة نفسها — إعادة الحساب
 * (reposition) لا تلزم إلا مرة واحدة عند تحميل/تبديل الصفحة، تمامًا كما كانت
 * تُستدعى أصلاً.
 */

const ZoomViewer = (() => {
  "use strict";

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  const DOUBLE_TAP_SCALE = 2.4;
  const DOUBLE_TAP_MS = 300;   // أقصى فارق زمني بين نقرتين لتُحتسبا نقرة مزدوجة
  const DOUBLE_TAP_SLOP = 34;  // أقصى تباعد (px) بين موضعي النقرتين
  const TAP_SLOP = 10;         // أقصى حركة (px) لا تزال تُحتسب "نقرة" لا "سحبة"
  const MIN_SWIPE_DISTANCE = 42;
  const MAX_OFF_AXIS = 65;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ينشئ محرّك تكبير/تحريك واحدًا مربوطًا بعنصرَي viewport (المنفذ الثابت
  // الحجم الذي يقصّ المحتوى) وsurface (العنصر الذي يُطبَّق عليه transform).
  function attach({ viewportEl, surfaceEl, onTap, onSwipeNav, onZoomChange }) {
    let scale = 1, panX = 0, panY = 0;
    const pointers = new Map(); // pointerId -> {x, y}
    let mode = null;            // null | "pan" | "pinch"
    let dragMoved = false;
    let startX = 0, startY = 0;
    let lastX = 0, lastY = 0;
    let pinchLastDist = 0;
    let pendingTapTimer = null;
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0;

    function apply() {
      surfaceEl.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
    }

    function notifyZoom() {
      if (typeof onZoomChange === "function") onZoomChange(scale);
    }

    function clampPan() {
      const vw = viewportEl.clientWidth, vh = viewportEl.clientHeight;
      const maxX = Math.max(0, (vw * (scale - 1)) / 2);
      const maxY = Math.max(0, (vh * (scale - 1)) / 2);
      panX = clamp(panX, -maxX, maxX);
      panY = clamp(panY, -maxY, maxY);
    }

    // cx, cy: نقطة الارتكاز نسبة لمركز viewportEl (px) — التكبير/التصغير
    // يبقيها ثابتة بصريًا في مكانها على الشاشة (تمامًا كسلوك Pinch الطبيعي).
    function zoomToPoint(newScale, cx, cy) {
      const contentX = (cx - panX) / scale;
      const contentY = (cy - panY) / scale;
      const clamped = clamp(newScale, MIN_SCALE, MAX_SCALE);
      if (clamped === scale) return;
      scale = clamped;
      panX = cx - contentX * scale;
      panY = cy - contentY * scale;
      clampPan();
      apply();
      notifyZoom();
    }

    function reset() {
      scale = 1; panX = 0; panY = 0;
      surfaceEl.classList.add("zoom-animated");
      apply();
      notifyZoom();
      window.setTimeout(() => surfaceEl.classList.remove("zoom-animated"), 220);
    }

    function pointRelativeToCenter(clientX, clientY) {
      const r = viewportEl.getBoundingClientRect();
      return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
    }

    function cancelPendingTap() {
      if (pendingTapTimer) { window.clearTimeout(pendingTapTimer); pendingTapTimer = null; }
    }

    function handleDoubleTapAt(clientX, clientY) {
      const p = pointRelativeToCenter(clientX, clientY);
      surfaceEl.classList.add("zoom-animated");
      window.setTimeout(() => surfaceEl.classList.remove("zoom-animated"), 220);
      if (scale > 1.05) {
        panX = 0; panY = 0; scale = 1;
        clampPan(); apply(); notifyZoom();
      } else {
        zoomToPoint(DOUBLE_TAP_SCALE, p.x, p.y);
      }
    }

    function commitSingleTap(clientX, clientY) {
      if (typeof onTap === "function") onTap(clientX, clientY);
    }

    surfaceEl.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".error-mark")) return; // اترك حذف العلامة لمتحكّمها الخاص
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { surfaceEl.setPointerCapture(e.pointerId); } catch (err) { /* يمكن تجاهله بأمان */ }
      dragMoved = false;

      if (pointers.size === 1) {
        mode = "pan";
        startX = lastX = e.clientX;
        startY = lastY = e.clientY;
      } else if (pointers.size === 2) {
        cancelPendingTap(); // إصبع ثانٍ يعني أن هذه ليست نقرة أبدًا
        mode = "pinch";
        const pts = [...pointers.values()];
        pinchLastDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      }
    });

    surfaceEl.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (mode === "pinch" && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
        const midClientX = (pts[0].x + pts[1].x) / 2;
        const midClientY = (pts[0].y + pts[1].y) / 2;
        const mid = pointRelativeToCenter(midClientX, midClientY);
        const ratio = dist / (pinchLastDist || dist);
        pinchLastDist = dist;
        dragMoved = true;
        zoomToPoint(scale * ratio, mid.x, mid.y);
        return;
      }

      if (mode === "pan") {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragMoved && Math.hypot(dx, dy) > TAP_SLOP) { dragMoved = true; cancelPendingTap(); }
        if (dragMoved && scale > 1.001) {
          panX += e.clientX - lastX;
          panY += e.clientY - lastY;
          clampPan();
          apply();
        }
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });

    function endPointer(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);

      if (mode === "pinch") {
        // خروج إصبع واحد من أصل اثنين: إنهاء التكبير بإصبعين، وليس بداية سحب جديد بالإصبع المتبقّي
        if (pointers.size === 0) mode = null;
        return;
      }

      if (mode === "pan" && pointers.size === 0) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        mode = null;

        if (!dragMoved) {
          // نقرة نظيفة: تحقّق أولًا من كونها ثاني نقرتين متتاليتين (نقرة مزدوجة)
          const now = Date.now();
          const closeEnough = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) <= DOUBLE_TAP_SLOP;
          if (now - lastTapTime <= DOUBLE_TAP_MS && closeEnough) {
            cancelPendingTap();
            lastTapTime = 0;
            handleDoubleTapAt(e.clientX, e.clientY);
          } else {
            lastTapTime = now;
            lastTapX = e.clientX;
            lastTapY = e.clientY;
            cancelPendingTap();
            // نؤجّل تنفيذ النقرة المفردة قليلاً، فقط للتأكّد أنها لن تتحوّل لنقرة
            // مزدوجة خلال هذه المهلة (وإلا لأُضيفت علامة خطأ خطأً عند كل تكبير)
            pendingTapTimer = window.setTimeout(() => {
              pendingTapTimer = null;
              commitSingleTap(e.clientX, e.clientY);
            }, DOUBLE_TAP_MS);
          }
          return;
        }

        if (scale <= 1.001) {
          const isSwipe = Math.abs(dx) >= MIN_SWIPE_DISTANCE && Math.abs(dy) <= MAX_OFF_AXIS;
          if (isSwipe && typeof onSwipeNav === "function") onSwipeNav(dx < 0 ? "left" : "right");
        }
      }
    }

    surfaceEl.addEventListener("pointerup", endPointer);
    surfaceEl.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); mode = null; });
    surfaceEl.addEventListener("dragstart", (e) => e.preventDefault());

    return {
      reset,
      getScale: () => scale,
      isZoomed: () => scale > 1.001,
    };
  }

  return { attach };
})();
