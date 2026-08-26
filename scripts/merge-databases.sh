#!/bin/bash
cd "$(dirname "$0")/.."

echo "Объединяем базы данных..."

# Используем Node.js скрипт
node scripts/merge-databases.js

if [ $? -eq 0 ]; then
  echo ""
  echo "Проверяем результаты..."
  echo "Source: $(sqlite3 prisma/dev.db 'SELECT COUNT(*) FROM Source;')"
  echo "JobPosting: $(sqlite3 prisma/dev.db 'SELECT COUNT(*) FROM JobPosting;')"
  echo ""
  echo "Удаляем старую базу данных..."
  rm -f dev.db
  echo "Готово!"
else
  echo "Ошибка при объединении баз данных"
  exit 1
fi

