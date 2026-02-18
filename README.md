# Start.

### Простой RSS-ридер с колонками в духе TweetDeck

![Скриншот Start.](.github/screenshot.png)

## Что умеет

- Колонки по папкам: каждая папка рендерится отдельной колонкой.
- Ручное управление источниками: создание/удаление папок и RSS-подписок.
- Обновление лент по кнопке и при старте приложения.
- Сохранение состояния в `localStorage` (без бэкенда).
- Импорт и экспорт настроек в JSON.
- Адаптивный интерфейс

## Технологии

- JavaScript (ES Modules)
- SCSS
- Parcel

## Быстрый старт

```bash
npm install
npm run dev
```

Приложение будет доступно по адресу `http://localhost:1234`.

## Скрипты

- `npm run dev` / `npm start` — запуск dev-сервера Parcel.
- `npm run build` — production-сборка в `dist/`.

## Структура проекта

```text
public/index.html          # точка входа
src/scripts/main.js        # инициализация и обработчики UI-событий
src/scripts/domain.js      # загрузка/парсинг RSS и бизнес-логика
src/scripts/ui.js          # рендер интерфейса
src/scripts/storage.js     # localStorage
src/styles/                # SCSS-стили
dist/                      # production-сборка (генерируется)
```
