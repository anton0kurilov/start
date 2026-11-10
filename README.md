# Start.

Персональный RSS/Atom-ридер с колонками в духе TweetDeck.

## Возможности

- Колонки и подписки, избранные источники и локальные рекомендации.
- Ручное и автоматическое обновление, отметки прочитанного, фильтр заголовков.
- Клавиатурная и pointer-перестановка колонок.
- Локальное состояние в localStorage; совместимый JSON import/export.
- Адаптивный интерфейс и web manifest для установки. Полноценного offline-кэша
  публикаций и Service Worker пока нет.

## Разработка

Нужен Node.js 22.12+ (или более новая поддерживаемая версия).

```bash
npm install
npm start
```

Dev-сервер — http://127.0.0.1:1234. Команда npm run dev также открывает браузер.

| Команда            | Назначение                                           |
| ------------------ | ---------------------------------------------------- |
| npm run check      | Строгая проверка Svelte/TypeScript                   |
| npm run build      | Статическая production-сборка в dist                 |
| npm run preview    | Локальный просмотр dist на 127.0.0.1:4173            |
| npm run test:smoke | Домен, контроллер и геометрия чтения через node:test |
| npm run test:e2e   | Playwright против production preview на порту 4174   |

Перед первым запуском E2E установить браузер: npx playwright install chromium.
Перед E2E выполнить npm run build. Тесты используют отдельный профиль и
мокированные RSS, не изменяя пользовательские данные. Скриншоты и метрики:
node tests/e2e/measure.mjs svelte при работающем preview; APP_URL позволяет
выбрать другой адрес. Артефакты находятся в output/playwright и не коммитятся.

## Устройство

- Svelte 5, TypeScript для нового UI, Vite и SCSS.
- index.html и src/main.ts — вход; src/app.svelte — оболочка приложения.
- src/components — компоненты чтения, настроек и общие контролы.
- src/app/controller.ts — команды и read-only store снимков UI.
- src/app — типы, иконки, геометрия чтения, drag и общий учёт показов.
- src/scripts/domain.js — существующие бизнес-правила и RSS; model-state.js,
  state-normalizers.js, storage.js, utils.js и constants.js остаются на JS.
- src/styles/_tokens.scss — единые шкалы и семантические цвета.
- public/assets/icons — manifest, иконки и установочные ресурсы.

## UI/UX

[Дизайн-система](docs/README.md), [переезд и результаты](docs/svelte-migration.md),
[проверки и ограничения](docs/ui-audit.md).

Ключ start:rss:v1 и формат экспорта сохранены. Выпуск остаётся статическим;
откат выполняется возвратом предыдущей сборки без миграции хранилища.
