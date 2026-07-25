"""
import_pages.py — أداة استيراد صور صفحات المصحف إلى جذر مشروع quran-app
مباشرة (وليس داخل مجلد images/)، مع إعادة تسمية تلقائية بالصيغة
page-<رقم الصفحة>.jpg وضغط الصور لتصغير حجمها دون فقدان وضوح النص.

ملاحظة: الصور تُوضَع في جذر المشروع (بجانب index.html) لأن بعض واجهات
الرفع (مثل رفع الملفات في GitHub) لا تقبل أكثر من 100 ملف دفعة واحدة عند
الرفع داخل مجلد فرعي واحد بسهولة؛ الرفع دفعات مباشرة إلى الجذر أبسط.

الاستخدام:
    python3 import_pages.py <مجلد الصور المصدر> <رقم أول صفحة في المجلد>

مثال: لديك مجلد "juz29" يحوي 20 صورة مرتبة من صفحة 562 إلى 581:
    python3 import_pages.py juz29 562

الشرط الوحيد: أن تكون أسماء الملفات داخل المجلد المصدر مرتبة أبجديًا
بنفس ترتيب صفحات المصحف (وهو الحال المعتاد في مجلدات المصاحف المصوَّرة
مثل Ahzeb_01-60_0567.jpg، Ahzeb_01-60_0568.jpg ...).
"""

import sys
import os
from PIL import Image

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_DIR = PROJECT_ROOT
MAX_WIDTH = 1000
JPEG_QUALITY = 82
VALID_EXT = (".jpg", ".jpeg", ".png", ".webp")


def import_pages(source_dir, start_page):
    if not os.path.isdir(source_dir):
        print(f"خطأ: المجلد غير موجود: {source_dir}")
        sys.exit(1)

    files = sorted(f for f in os.listdir(source_dir) if f.lower().endswith(VALID_EXT))
    if not files:
        print("لم يتم العثور على أي صور بصيغة jpg/jpeg/png/webp داخل المجلد.")
        sys.exit(1)

    os.makedirs(DEST_DIR, exist_ok=True)

    for i, fname in enumerate(files):
        page = start_page + i
        src_path = os.path.join(source_dir, fname)
        try:
            img = Image.open(src_path).convert("RGB")
        except Exception as e:
            print(f"تخطّي {fname}: تعذّرت قراءتها ({e})")
            continue

        if img.width > MAX_WIDTH:
            ratio = MAX_WIDTH / img.width
            img = img.resize((MAX_WIDTH, int(img.height * ratio)), Image.LANCZOS)

        out_name = f"page-{page}.jpg"
        out_path = os.path.join(DEST_DIR, out_name)
        img.save(out_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
        print(f"{fname}  ->  {out_name}")

    print(f"\nتم استيراد {len(files)} صفحة، من الصفحة {start_page} إلى {start_page + len(files) - 1}.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("الاستخدام: python3 import_pages.py <مجلد الصور المصدر> <رقم أول صفحة>")
        sys.exit(1)
    import_pages(sys.argv[1], int(sys.argv[2]))
