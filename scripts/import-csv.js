const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Строка подключения к MongoDB
const MONGODB_URI = "mongodb+srv://user123:user123pass@cluster.ye9rgkq.mongodb.net/toxicity_db";

// Определяем схему для данных
const toxicWordSchema = new mongoose.Schema({
  word: String,
  meaning: String,
  toxic: Number,
  insult: Number,
  obscenity: Number,
  rudeness: Number,
  reputation: Number,
  danger: Number
});
const ToxicWord = mongoose.model('ToxicWord', toxicWordSchema);

async function importCsv() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Подключено к MongoDB');

    // Очищаем коллекцию перед импортом
    await ToxicWord.deleteMany({});
    console.log('🗑️ Старые данные удалены');

    const results = [];
    const filePath = path.join(__dirname, '..', 'data', 'toxic_words.csv');

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        // Преобразуем строки в нужный формат
        results.push({
          word: data['Уытты сөз'],
          meaning: data['Мағынасы'],
          toxic: parseFloat(data['Токсиндік']),
          insult: parseFloat(data['Қорлау (%)']),
          obscenity: parseFloat(data['Былапыт (%)']),
          rudeness: parseFloat(data['Дөрекілік (%)']),
          reputation: parseFloat(data['Репутация (%)']),
          danger: parseFloat(data['Қауіп (%)'])
        });
      })
      .on('end', async () => {
        await ToxicWord.insertMany(results);
        console.log(`✅ Импортировано ${results.length} слов`);
        process.exit(0);
      });
  } catch (error) {
    console.error('Ошибка импорта:', error);
    process.exit(1);
  }
}

importCsv();