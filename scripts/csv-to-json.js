const fs = require('fs');
const path = require('path');

// Путь к вашему CSV-файлу (укажите правильный)
const csvFilePath = path.join(__dirname, '..', 'data', 'Уытты сөздер талдауы_ 31-60 блок (1) - Уытты сөздер талдауы 31-60 блок (1).csv');

// Читаем файл в кодировке UTF-8
const csvContent = fs.readFileSync(csvFilePath, 'utf8');

// Разбиваем на строки
const lines = csvContent.split(/\r?\n/);
if (lines.length === 0) return;

// Заголовки (предполагаем, что первая строка содержит названия колонок)
const headers = lines[0].split(',').map(h => h.replace(/["']/g, '').trim());

// Массив для результатов
const result = [];

// Обрабатываем строки, начиная со второй
for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    
    // Разбиваем по запятым, но с учётом кавычек (простейший способ - использовать regex)
    // Более надёжно: использовать парсер CSV, но для простоты можно так:
    const values = [];
    let inQuote = false;
    let current = '';
    for (let ch of line) {
        if (ch === '"') {
            inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
            values.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    values.push(current.trim());
    
    if (values.length !== headers.length) {
        console.warn(`Пропущена строка ${i+1}: несовпадение колонок`);
        continue;
    }
    
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
        let val = values[j];
        // Убираем кавычки
        val = val.replace(/^"|"$/g, '');
        // Преобразуем числа
        if (headers[j] === 'Токсиндік' || headers[j] === 'Қорлау (%)' || headers[j] === 'Былапыт (%)' ||
            headers[j] === 'Дөрекілік (%)' || headers[j] === 'Репутация (%)' || headers[j] === 'Қауіп (%)') {
            // Убираем знак процента и преобразуем в число (делим на 100)
            let num = parseFloat(val.replace('%', ''));
            if (isNaN(num)) num = 0;
            obj[headers[j]] = num / 100;
        } else {
            obj[headers[j]] = val;
        }
    }
    
    // Переименовываем поля в латиницу
    const finalObj = {
        word: obj['Уытты сөз'] || obj['word'],
        meaning: obj['Мағынасы'] || obj['meaning'],
        toxic: obj['Токсиндік'] || 0,
        insult: obj['Қорлау (%)'] || 0,
        obscenity: obj['Былапыт (%)'] || 0,
        rudeness: obj['Дөрекілік (%)'] || 0,
        reputation: obj['Репутация (%)'] || 0,
        danger: obj['Қауіп (%)'] || 0
    };
    
    // Проверяем, что слово не пустое
    if (finalObj.word && finalObj.word !== '№') {
        result.push(finalObj);
    }
}

// Сохраняем в JSON файл
const outputPath = path.join(__dirname, '..', 'data', 'toxic-words-clean.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`Готово! Сохранено ${result.length} слов в ${outputPath}`);