const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const { Telegraf } = require("telegraf");

const app = express();

// =================== КОНФИГУРАЦИЯ ===================
const PORT = process.env.PORT || 5000;
const HF_TOKEN = process.env.HF_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_this_in_production";
const MODEL_NAME = "cointegrated/rubert-tiny-toxicity";
const API_URL = `https://router.huggingface.co/hf-inference/models/${MODEL_NAME}`;
const TIMEOUT_MS = 30000;

// Telegram
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || "/webhook";

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

// Проверка обязательных переменных окружения
const requiredEnvVars = ['HF_TOKEN', 'MONGODB_URI', 'JWT_SECRET'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(` ${varName} не установлен в переменных окружения!`);
  }
});

// =================== ПОДКЛЮЧЕНИЕ К MONGODB ===================
mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
.then(() => console.log(" MongoDB подключена успешно"))
.catch(err => console.error(" Ошибка подключения к MongoDB:", err.message));

mongoose.connection.on('error', err => console.error('MongoDB connection error:', err));
mongoose.connection.on('disconnected', () => console.log('MongoDB отключена'));

// =================== СХЕМЫ БАЗЫ ДАННЫХ ===================
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

const User = mongoose.model("User", userSchema);
const History = mongoose.model("History", historySchema);

// =================== MIDDLEWARE АУТЕНТИФИКАЦИИ ===================
const authenticateToken = (req, res, next) => {
    // Пропускаем внутренние запросы от бота
    if (req.headers['x-internal-request'] === 'true') {
        return next();
    }
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "Қатынау үшін жүйеге кіріңіз" });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Токен жарамсыз, қайта кіріңіз" });
        }
        req.user = user;
        next();
    });
};

// =================== API ЭНДПОЙНТЫ ===================
// Регистрация
app.post("/api/register", async (req, res) => {
    console.log("Получен запрос на регистрацию:", req.body);
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: "Барлық өрістерді толтырыңыз" });
    }
    if (username.length < 3) {
        return res.status(400).json({ error: "Пайдаланушы аты кемінде 3 символ болуы керек" });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: "Құпия сөз кемінде 6 символ болуы керек" });
    }
    try {
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: "Пайдаланушы аты немесе email қолданыста" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword });
        await user.save();
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        console.log("Пользователь создан:", username);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (error) {
        console.error("Ошибка регистрации:", error);
        res.status(500).json({ error: "Сервер қатесі: " + error.message });
    }
});

// Вход
app.post("/api/login", async (req, res) => {
    console.log("Получен запрос на вход:", req.body.username);
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Пайдаланушы аты және құпия сөзді толтырыңыз" });
    }
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: "Пайдаланушы табылмады" });
        }
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: "Құпия сөз қате" });
        }
        const token = jwt.sign(
            { userId: user._id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        console.log("Успешный вход:", username);
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (error) {
        console.error("Ошибка входа:", error);
        res.status(500).json({ error: "Сервер қатесі: " + error.message });
    }
});

// Проверка токсичности (основной алгоритм)
app.post("/check", authenticateToken, async (req, res) => {
    const { text } = req.body;
    if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "Мәтінді енгізіңіз", toxic: false, score: 0, reason: "Мәтінді енгізіңіз" });
    }
    try {
        console.log("Проверка текста:", text.substring(0, 50));
        const fetchPromise = fetch(API_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        });
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS));
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        if (response.status === 503) {
            return res.json({ toxic: false, score: 0, reason: "Модель жүктелуде, кейінірек қайталаңыз", error: "model_loading" });
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log("Ответ модели:", JSON.stringify(data).substring(0, 200));
        
        let scores = { "non-toxic": 0, "insult": 0, "obscenity": 0, "threat": 0, "dangerous": 0 };
        if (Array.isArray(data)) {
            if (data[0] && Array.isArray(data[0])) {
                for (const item of data[0]) {
                    if (item.label && typeof item.score === 'number') scores[item.label] = item.score;
                }
            } else if (data[0] && data[0].label) {
                for (const item of data) {
                    if (item.label && typeof item.score === 'number') scores[item.label] = item.score;
                }
            }
        }
        const nonToxic = scores["non-toxic"] || 0;
        const insult = scores["insult"] || 0;
        const obscenity = scores["obscenity"] || 0;
        const threat = scores["threat"] || 0;
        const dangerous = scores["dangerous"] || 0;
        const isToxic = nonToxic < 0.7 || dangerous > 0.5 || insult > 0.5;
        const toxicScore = Math.max(insult, obscenity, threat, dangerous);
        let reason = "";
        if (dangerous > 0.7) reason = "Өте қауіпті: мәтін беделге нұқсан келтіруі мүмкін";
        else if (dangerous > 0.5) reason = "Жоғары тәуекел: беделге ықтимал зиян";
        else if (insult > 0.7) reason = "Айқын қорлау";
        else if (insult > 0.5) reason = "Жасырын қорлау немесе менсінбеушілік";
        else if (threat > 0.5) reason = "Қауіп-қатер анықталды";
        else if (obscenity > 0.5) reason = "Бағымсыз сөздер";
        else if (nonToxic < 0.7) reason = "Мәтінде токсинді элементтер бар";
        else reason = "Мәтін қауіпсіз";
        const result = { toxic: isToxic, score: toxicScore, reason, details: { non_toxic: nonToxic, insult, obscenity, threat, dangerous } };
        await History.create({ userId: req.user.userId, text, result });
        await User.findByIdAndUpdate(req.user.userId, { $inc: { checksCount: 1 } });
        console.log("Проверка завершена, токсично:", isToxic);
        res.json(result);
    } catch (error) {
        console.error("Ошибка при проверке:", error.message);
        res.status(500).json({ error: "Сервер қатесі: " + error.message, toxic: false, score: 0, reason: "Мәтінді тексеру мүмкін болмады" });
    }
});

// История
app.get("/api/history", authenticateToken, async (req, res) => {
    try {
        const history = await History.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(50);
        res.json(history);
    } catch (error) {
        console.error("Ошибка загрузки истории:", error);
        res.status(500).json({ error: "Тарихты жүктеу мүмкін болмады" });
    }
});

// Статистика
app.get("/api/stats", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const totalChecks = user.checksCount;
        const toxicChecks = await History.countDocuments({ userId: req.user.userId, "result.toxic": true });
        res.json({ totalChecks, toxicChecks, safeChecks: totalChecks - toxicChecks });
    } catch (error) {
        console.error("Ошибка загрузки статистики:", error);
        res.status(500).json({ error: "Статистиканы жүктеу мүмкін болмады" });
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok", model: MODEL_NAME, timestamp: new Date().toISOString(), mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected" });
});

// =================== ОТДАЧА СТАТИКИ REACT ===================
app.use(express.static(path.join(__dirname, 'client/build')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// =================== TELEGRAM БОТ (МОДЕРАТОР ГРУПП) ===================
let bot = null;
if (BOT_TOKEN) {
    bot = new Telegraf(BOT_TOKEN);
    console.log(" Telegram бот инициализирован");
} else {
    console.warn(" TELEGRAM_BOT_TOKEN не задан. Бот не будет работать.");
}

// Функция для проверки токсичности через внутренний API
async function checkTextToxicity(text) {
    try {
        const response = await fetch(`http://localhost:${PORT}/check`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Request': 'true'
            },
            body: JSON.stringify({ text })
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error('Ошибка вызова /check из бота:', err.message);
        return null;
    }
}

if (bot) {
    // Обработка текстовых сообщений в группах
    bot.on('text', async (ctx) => {
        const message = ctx.message;
	console.log(`[DEBUG] Получено сообщение от ${message.from.username || message.from.first_name}: ${message.text}`);
        if (message.from.is_bot) return;
        // Работаем только в группах и супергруппах
        if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') return;
        console.log(`[Группа ${message.chat.id}] Сообщение от ${message.from.username || message.from.first_name}: ${message.text.substring(0, 50)}`);
        const result = await checkTextToxicity(message.text);
        if (result && result.toxic) {
            const warning = ` Внимание, ${message.from.first_name || 'участник'}! Ваше сообщение признано токсичным (уверенность ${Math.round(result.score * 100)}%).\nПричина: ${result.reason}`;
            await ctx.reply(warning, { reply_to_message_id: message.message_id });
            // Раскомментируйте следующую строку, если бот имеет право удалять сообщения
            // await ctx.deleteMessage(message.message_id);
        }
    });

    // Настройка webhook (будет вызвано после запуска сервера)
    bot.telegram.setWebhook = bot.telegram.setWebhook.bind(bot.telegram);
}

// =================== ЗАПУСК СЕРВЕРА И УСТАНОВКА WEBHOOK ===================
const startServer = async () => {
    app.listen(PORT, '0.0.0.0', async () => {
        console.log(` Сервер запущен на порту ${PORT}`);
        console.log(` Модель: ${MODEL_NAME}`);
        console.log(` HF_TOKEN: ${HF_TOKEN ? 'Установлен' : 'Не установлен'}`);
        console.log(` MongoDB: ${MONGODB_URI ? 'URL указан' : 'Не указан'}`);
        console.log(` JWT_SECRET: ${JWT_SECRET !== "default_secret_change_this_in_production" ? 'Установлен' : 'Используется дефолтный'}`);
        
        if (bot && process.env.RENDER_EXTERNAL_URL) {
            const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}${WEBHOOK_PATH}`;
            try {
                await bot.telegram.setWebhook(webhookUrl);
                console.log(` Webhook для Telegram установлен: ${webhookUrl}`);
            } catch (err) {
                console.error(' Ошибка установки webhook:', err.message);
            }
        } else if (bot) {
            console.warn(' RENDER_EXTERNAL_URL не задан. Webhook не установлен автоматически.');
        }
    });
};

startServer();

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error("Глобальная ошибка:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
});