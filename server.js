const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const { Telegraf } = require("telegraf");

const app = express();

// =================== КОНФИГУРАЦИЯ ===================
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_this_in_production";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// =================== MIDDLEWARES ===================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(express.json({ limit: '10mb' }));

if (!MONGODB_URI) console.error("MONGODB_URI не задан");
if (!JWT_SECRET) console.error("JWT_SECRET не задан");

// =================== ПОДКЛЮЧЕНИЕ К MONGODB ===================
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
.then(() => console.log("MongoDB подключена успешно"))
.catch(err => console.error("Ошибка подключения к MongoDB:", err.message));

mongoose.connection.on('error', err => console.error('MongoDB connection error:', err));
mongoose.connection.on('disconnected', () => console.log('MongoDB отключена'));

// =================== СХЕМЫ ===================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    checksCount: { type: Number, default: 0 }
});

const historySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true },
    result: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
});

const warningSchema = new mongoose.Schema({
    userId: { type: Number, required: true },
    chatId: { type: Number, required: true },
    count: { type: Number, default: 1 },
    lastWarningDate: { type: Date, default: Date.now }
});

const toxicWordSchema = new mongoose.Schema({
    word: { type: String, required: true, unique: true },
    meaning: String,
    toxic: { type: Number, default: 0 },
    insult: { type: Number, default: 0 },
    obscenity: { type: Number, default: 0 },
    rudeness: { type: Number, default: 0 },
    reputation: { type: Number, default: 0 },
    danger: { type: Number, default: 0 }
});

const User = mongoose.model("User", userSchema);
const History = mongoose.model("History", historySchema);
const Warning = mongoose.model("Warning", warningSchema);
const ToxicWord = mongoose.model("ToxicWord", toxicWordSchema);

// =================== АУТЕНТИФИКАЦИЯ ===================
const authenticateToken = (req, res, next) => {
    if (req.headers['x-internal-request'] === 'true') return next();
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Қатынау үшін жүйеге кіріңіз" });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Токен жарамсыз, қайта кіріңіз" });
        req.user = user;
        next();
    });
};

// =================== ФУНКЦИЯ АНАЛИЗА ===================
async function analyzeTextWithDatabase(text) {
    // Нормализация: нижний регистр, удаление пунктуации
    const normalizedText = text.toLowerCase().replace(/[^\w\s]/g, '');
    const words = normalizedText.split(/\s+/);
    let foundWords = [];

    // Поиск отдельных слов с игнорированием регистра (используем regex)
    for (const word of words) {
        if (!word) continue;
        // Ищем точное совпадение, но без учёта регистра
        const found = await ToxicWord.findOne({ word: { $regex: new RegExp('^' + word + '$', 'i') } });
        if (found) {
            console.log(`Найдено слово: ${found.word}`);
            foundWords.push(found);
        } else {
            console.log(`Слово не найдено: ${word}`);
        }
    }

    // Поиск фраз (с пробелами) - тоже без учёта регистра
    const allPhrases = await ToxicWord.find({});
    for (const phrase of allPhrases) {
        if (phrase.word.includes(' ') && normalizedText.includes(phrase.word.toLowerCase())) {
            console.log(`Найдена фраза: ${phrase.word}`);
            foundWords.push(phrase);
        }
    }

    if (foundWords.length === 0) {
        return {
            toxic: false,
            score: 0,
            reason: "Уытты емес",
            details: { toxic: 0, insult: 0, obscenity: 0, rudeness: 0, reputation: 0, danger: 0 }
        };
    }

    const maxScores = { toxic: 0, insult: 0, obscenity: 0, rudeness: 0, reputation: 0, danger: 0 };
    for (const word of foundWords) {
        maxScores.toxic = Math.max(maxScores.toxic, Number(word.toxic) || 0);
        maxScores.insult = Math.max(maxScores.insult, Number(word.insult) || 0);
        maxScores.obscenity = Math.max(maxScores.obscenity, Number(word.obscenity) || 0);
        maxScores.rudeness = Math.max(maxScores.rudeness, Number(word.rudeness) || 0);
        maxScores.reputation = Math.max(maxScores.reputation, Number(word.reputation) || 0);
        maxScores.danger = Math.max(maxScores.danger, Number(word.danger) || 0);
    }

    const toxicScore = maxScores.toxic;
    const isToxic = toxicScore > 0.5;
    let reason = "";
    if (maxScores.danger > 0.7) reason = "Өте қауіпті: мәтін беделге нұқсан келтіруі мүмкін";
    else if (maxScores.danger > 0.5) reason = "Жоғары тәуекел: беделге ықтимал зиян";
    else if (maxScores.insult > 0.7) reason = "Айқын қорлау";
    else if (maxScores.insult > 0.5) reason = "Жасырын қорлау немесе менсінбеушілік";
    else if (maxScores.rudeness > 0.7) reason = "Дөрекі сөздер";
    else if (maxScores.obscenity > 0.5) reason = "Былапыт сөздер";
    else if (maxScores.toxic > 0.5) reason = "Мәтінде токсинді элементтер бар";
    else reason = "Мәтін қауіпсіз";

    return {
        toxic: isToxic,
        score: toxicScore,
        reason: reason,
        details: {
            toxic: (maxScores.toxic * 100) || 0,
            insult: (maxScores.insult * 100) || 0,
            obscenity: (maxScores.obscenity * 100) || 0,
            rudeness: (maxScores.rudeness * 100) || 0,
            reputation: (maxScores.reputation * 100) || 0,
            danger: (maxScores.danger * 100) || 0
        },
        found_words: foundWords.map(w => w.word)
    };
}

// =================== API ЭНДПОЙНТЫ ===================
app.post("/api/register", async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Барлық өрістерді толтырыңыз" });
    if (username.length < 3) return res.status(400).json({ error: "Пайдаланушы аты кемінде 3 символ болуы керек" });
    if (password.length < 6) return res.status(400).json({ error: "Құпия сөз кемінде 6 символ болуы керек" });
    try {
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) return res.status(400).json({ error: "Пайдаланушы аты немесе email қолданыста" });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (error) {
        res.status(500).json({ error: "Сервер қатесі: " + error.message });
    }
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Пайдаланушы аты және құпия сөзді толтырыңыз" });
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ error: "Пайдаланушы табылмады" });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ error: "Құпия сөз қате" });
        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (error) {
        res.status(500).json({ error: "Сервер қатесі: " + error.message });
    }
});

app.post("/check", authenticateToken, async (req, res) => {
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Мәтінді енгізіңіз", toxic: false, score: 0, reason: "Мәтінді енгізіңіз" });
    }
    try {
        const result = await analyzeTextWithDatabase(text);
        if (req.user) {
            await History.create({ userId: req.user.userId, text, result });
            await User.findByIdAndUpdate(req.user.userId, { $inc: { checksCount: 1 } });
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: "Сервер қатесі: " + error.message, toxic: false, score: 0, reason: "Мәтінді тексеру мүмкін болмады" });
    }
});

app.get("/api/history", authenticateToken, async (req, res) => {
    try {
        const history = await History.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(50);
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: "Тарихты жүктеу мүмкін болмады" });
    }
});

app.get("/api/stats", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const totalChecks = user.checksCount;
        const toxicChecks = await History.countDocuments({ userId: req.user.userId, "result.toxic": true });
        res.json({ totalChecks, toxicChecks, safeChecks: totalChecks - toxicChecks });
    } catch (error) {
        res.status(500).json({ error: "Статистиканы жүктеу мүмкін болмады" });
    }
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

// =================== ОТДАЧА СТАТИКИ REACT ===================
const buildPath = path.join(__dirname, 'client/build');
if (fs.existsSync(buildPath)) {
    app.use(express.static(buildPath));
    app.get('*', (req, res) => {
        res.sendFile(path.join(buildPath, 'index.html'));
    });
} else {
    console.log("Папка client/build не найдена. Фронтенд не будет отдаваться.");
}

// =================== TELEGRAM БОТ ===================
let bot = null;
if (BOT_TOKEN) {
    bot = new Telegraf(BOT_TOKEN);
    console.log("Telegram бот инициализирован");
} else {
    console.warn("TELEGRAM_BOT_TOKEN не задан. Бот не будет работать.");
}

async function checkTextToxicity(text) {
    try {
        const response = await fetch(`http://localhost:${PORT}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Internal-Request': 'true' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Ошибка вызова /check из бота:', err.message);
        return null;
    }
}

const WARNING_THRESHOLD = 3;

if (bot) {
    bot.on('text', async (ctx) => {
        const message = ctx.message;
        if (message.from.is_bot) return;
        if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') return;

        const userId = message.from.id;
        const chatId = message.chat.id;
        const username = message.from.username || message.from.first_name;
        const text = message.text;

        const result = await checkTextToxicity(text);
        if (!result || !result.toxic) return;

        const toxicPercent = Math.round(result.score * 100);
        const reason = result.reason;

        let warning = await Warning.findOne({ userId, chatId });
        if (warning) {
            warning.count += 1;
            warning.lastWarningDate = new Date();
            await warning.save();
        } else {
            warning = await Warning.create({ userId, chatId, count: 1 });
        }

        if (warning.count >= WARNING_THRESHOLD) {
            try {
                await ctx.telegram.kickChatMember(chatId, userId);
                await ctx.reply(`${username} пайдаланушысы ${WARNING_THRESHOLD} уытты хабарлама жібергені үшін топтан шығарылды. Қайта қосылу үшін әкімшілікке хабарласыңыз.`);
                await Warning.deleteOne({ userId, chatId });
            } catch (err) {
                console.error(`Шығару мүмкін болмады ${userId}:`, err.message);
                await ctx.reply(`${username} пайдаланушысын шығару мүмкін болмады. Боттың «Пайдаланушыларды бұғаттау» құқығы бар екеніне көз жеткізіңіз.`);
            }
        } else {
            await ctx.reply(`Назар аударыңыз, ${username}! Сіздің хабарламаңыз уытты деп танылды (уыттылық деңгейі ${toxicPercent}%).\nСебебі: ${reason}\nБұл ескерту ${warning.count}/${WARNING_THRESHOLD}. Уытты хабарламалар жібермеуге тырысыңыз.`, { reply_to_message_id: message.message_id });
        }
    });

    bot.command('reset_warnings', async (ctx) => {
        if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;
        const member = await ctx.getChatMember(ctx.from.id);
        if (member.status !== 'administrator' && member.status !== 'creator') {
            return ctx.reply('Бұл команда тек әкімшілікке қолжетімді.');
        }
        if (!ctx.message.reply_to_message) {
            return ctx.reply('Пайдаланушының хабарына жауап беріңіз.');
        }
        const targetUserId = ctx.message.reply_to_message.from.id;
        const targetUsername = ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name;
        const deleted = await Warning.deleteOne({ userId: targetUserId, chatId: ctx.chat.id });
        if (deleted.deletedCount > 0) {
            await ctx.reply(`${targetUsername} пайдаланушысының деректері қалпына келтірілді.`);
        } else {
            await ctx.reply(`${targetUsername} пайдаланушысында белсенді ескертулер жоқ.`);
        }
    });
}

// =================== ЗАПУСК ===================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`MongoDB: ${MONGODB_URI ? 'URL указан' : 'Не указан'}`);
});

if (bot) {
    bot.launch();
    console.log("Telegram бот запущен");
}

process.once('SIGINT', () => { bot?.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot?.stop('SIGTERM'); process.exit(0); });

app.use((err, req, res, next) => {
    console.error("Глобальная ошибка:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
});