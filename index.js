// os-bot — этап 1 плана «Личная ОС»
// Два ручных сценария: /checkin (утреннее сообщение в рабочий чат)
// и /rate <курс> (рассылка курса всем партнёрам из фиксированного списка).
// Всё остальное (расписание, WhatsApp, фитнес) — следующие этапы.

require("dotenv").config();
const { Telegraf } = require("telegraf");
const http = require("http");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Нет BOT_TOKEN в переменных окружения. Задайте его в .env (локально) или в Railway → Variables.");
  process.exit(1);
}

// Кому разрешено запускать /checkin и /rate — список Telegram user_id через запятую.
// Свой user_id узнать просто: напишите боту /whoami.
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Рабочий чат для утреннего чек-ина (chat_id группы или личного чата).
const WORK_CHAT_ID = process.env.WORK_CHAT_ID || "";

// Партнёры для рассылки курса: "Имя:chat_id, Имя:chat_id, ...".
// chat_id партнёра появляется после того, как он один раз напишет боту /whoami.
const PARTNERS = (process.env.PARTNER_CHAT_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean)
  .map(pair => {
    const [name, id] = pair.split(":").map(s => s.trim());
    return { name: name || id, id };
  });

const MORNING_TEMPLATE = process.env.MORNING_TEMPLATE || "Доброе утро! Начинаю рабочий день.";
const RATE_TEMPLATE = process.env.RATE_TEMPLATE || "Курс на сегодня: {rate}";

const bot = new Telegraf(BOT_TOKEN);

function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from?.id));
}

// Служебная команда — вызывает любой пользователь один раз, чтобы узнать свой ID.
bot.command("whoami", ctx => {
  ctx.reply(
    `Ваш user_id: ${ctx.from.id}\nID этого чата (chat_id): ${ctx.chat.id}\n\n` +
    `Если вы партнёр — перешлите эти данные администратору, чтобы вас добавили в рассылку курса.`
  );
});

bot.command("checkin", ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Команда недоступна.");
  if (!WORK_CHAT_ID) return ctx.reply("Не задан WORK_CHAT_ID в переменных окружения.");
  bot.telegram
    .sendMessage(WORK_CHAT_ID, MORNING_TEMPLATE)
    .then(() => ctx.reply("Чек-ин отправлен."))
    .catch(err => ctx.reply(`Не получилось отправить: ${err.message}`));
});

// /rate 460
bot.command("rate", async ctx => {
  if (!isAdmin(ctx)) return ctx.reply("Команда недоступна.");
  const value = ctx.message.text.split(" ").slice(1).join(" ").trim();
  if (!value) return ctx.reply("Использование: /rate 460");
  if (PARTNERS.length === 0) return ctx.reply("Список партнёров пуст — задайте PARTNER_CHAT_IDS.");

  const text = RATE_TEMPLATE.replace("{rate}", value);
  const results = await Promise.allSettled(
    PARTNERS.map(p => bot.telegram.sendMessage(p.id, text))
  );

  const failed = results
    .map((r, i) => ({ r, p: PARTNERS[i] }))
    .filter(x => x.r.status === "rejected");

  let summary = `Разослано: ${results.length - failed.length} из ${results.length}.`;
  if (failed.length) {
    summary += "\nНе дошло до: " + failed.map(x => `${x.p.name} (${x.r.reason.message})`).join(", ");
  }
  ctx.reply(summary);
});

bot.command("help", ctx => {
  ctx.reply(
    "/whoami — узнать свой user_id и chat_id (для партнёров, один раз)\n" +
    "/checkin — отправить утреннее сообщение в рабочий чат (только админ)\n" +
    "/rate <курс> — разослать курс всем партнёрам (только админ)"
  );
});

console.log(`Токен: длина ${BOT_TOKEN.length} символов, начинается с "${BOT_TOKEN.slice(0, 6)}..."`);

// Сначала простой одиночный запрос к Telegram (getMe) — он либо быстро
// подтвердит, что токен рабочий и сеть до Telegram доходит, либо быстро
// покажет ошибку. Только после этого запускаем длинный long polling.
bot.telegram
  .getMe()
  .then(me => {
    console.log(`Подключение к Telegram OK. Это бот @${me.username} (id ${me.id}).`);
    return bot.launch();
  })
  .then(() => console.log("Бот запущен (long polling)."))
  .catch(err => {
    // Раньше ошибка здесь тихо роняла весь процесс (Node убивает процесс при
    // необработанном отклонении промиса) — контейнер уходил в бесконечный
    // цикл рестартов без единого объяснения в логах. Теперь причина видна.
    console.error("Не удалось запустить бота:", err.message);
  });

process.on("unhandledRejection", err => {
  console.error("Необработанная ошибка:", err);
});

// Необязательный HTTP-эндпоинт — на случай, если Railway настроит health check по порту.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    })
    .listen(process.env.PORT, () => console.log(`Health-check слушает порт ${process.env.PORT}`));
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
