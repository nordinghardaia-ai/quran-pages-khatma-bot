# Quran Pages & Khatma Bot

بوت Discord خفيف مستخرج من QuranBot، مخصص فقط لـ:

- `/quran`: عرض صفحات المصحف والتنقل بينها وحفظ آخر صفحة للمستخدم.
- `/khutma setup`: إرسال صفحة جديدة من المصحف دوريًا.
- `/khutma status`: عرض حالة الختمة.
- `/khutma stop`: إيقاف الختمة.

لا يحتاج هذا المشروع إلى **MongoDB** أو **Lavalink** أو API خارجي. التخزين محلي في `data/state.json`.

> صور صفحات المصحف عالية الدقة مأخوذة من [GovarJabbar/Quran-PNG](https://github.com/GovarJabbar/Quran-PNG)، وتُحمّل من GitHub Raw. لذلك يجب أن يكون السيرفر قادرًا على الوصول إلى الإنترنت.
> راجع ترخيص ونسب المصدر قبل إعادة التوزيع التجاري.

## المتطلبات

- Node.js 20 أو أحدث.
- تطبيق Bot من Discord Developer Portal.
- صلاحية `applications.commands` و`bot`.

## الإعداد

```bash
cp .env.example .env
```

ضع القيم التالية:

```env
DISCORD_TOKEN=توكن_البوت
DISCORD_CLIENT_ID=Application_ID
DISCORD_GUILD_ID=Server_ID_اختياري
```

`DISCORD_GUILD_ID` اختياري، لكنه مفيد أثناء الاختبار لأن أوامر السيرفر تسجل فورًا. إذا تركته فارغًا، يتم تسجيل الأوامر عالميًا وقد تحتاج Discord إلى وقت حتى تظهر.

## التشغيل

```bash
npm ci
npm start
```

أثناء التطوير:

```bash
npm run dev
```

## ملاحظات الختمة

- المدة المقبولة من 5 دقائق إلى يومين، مثل `30m` أو `2h` أو `1d`.
- تحتاج `/khutma setup` إلى صلاحية Manage Server.
- إعدادات الختمة محفوظة في `data/state.json`.
- إذا أعدت تشغيل البوت، يستكمل من الصفحة المحفوظة.
- بعد الصفحة 604 يرسل صورة إتمام الختمة ويوقف الدورة.
- احفظ مجلد `data` إذا أردت الاحتفاظ بالحالة عند النقل أو التحديث.

## النشر

يمكن تشغيله عبر PM2:

```bash
npm install -g pm2
pm2 start src/index.js --name quran-pages-khatma
pm2 save
```

أو عبر Docker بعد إضافة Dockerfile مناسب.

## الترخيص

Apache-2.0، مع الحفاظ على بيانات المشروع المصدر كما هي.
