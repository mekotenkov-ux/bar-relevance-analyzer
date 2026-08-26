# БАР — бесплатный анализ релевантности

![БАР — бесплатный анализ релевантности](public/og.png)

[![CI](https://github.com/mekotenkov-ux/bar-relevance-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/mekotenkov-ux/bar-relevance-analyzer/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-f3f3ee?style=flat-square&labelColor=151711)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.13-43853d?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Школа SEO Мясо](https://img.shields.io/badge/Школа-SEO_Мясо-d9ff43?style=flat-square&labelColor=151711)](https://seomeat.ru/)
[![Создатель @seokotenkov](https://img.shields.io/badge/Создатель-@seokotenkov-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://t.me/seokotenkov)

**БАР** — self-hosted open-source инструмент для сравнения страницы с
конкурентами из поисковой выдачи. Он анализирует леммы, N-граммы, HTML-зоны,
распределение терминов, облака слов, объём текста и опциональные семантические
связи.

Проект сделан в школе [SEO Мясо](https://seomeat.ru/). Создатель —
[Максим Котенков](https://t.me/seokotenkov).

> Статус: **pre-release**. БАР подходит для локальной работы и самостоятельного
> развёртывания. Перед публикацией общего сервера настройте авторизацию, лимиты,
> бюджет платных API, безопасное хранение секретов и мониторинг.

<details>
<summary>English summary</summary>

BAR is a self-hosted open-source relevance analyzer for comparing a page with
organic-search competitors. The main report does not require Python or an
external LLM. XMLRiver and Firecrawl are bring-your-own-key integrations. The
optional local spaCy relation service currently ships with Russian and English
models.

</details>

## Содержание

- [Возможности](#возможности)
- [Что потребуется](#что-потребуется)
- [Быстрый старт](#быстрый-старт)
- [Первый анализ](#первый-анализ)
- [Конфигурация](#конфигурация)
- [Семантические связи через spaCy](#семантические-связи-через-spacy)
- [Production self-hosting](#production-self-hosting)
- [Данные и безопасность](#данные-и-безопасность)
- [Разработка и правила для AI-агентов](#разработка-и-правила-для-ai-агентов)
- [Частые проблемы](#частые-проблемы)
- [Участие в проекте](#участие-в-проекте)
- [Авторство и лицензия](#авторство-и-лицензия)

## Возможности

- поиск конкурентов через XMLRiver без фиксированного лимита в интерфейсе;
- обычная HTTP-загрузка страниц с Firecrawl fallback только после ошибки или
  обнаружения антибот-заглушки;
- фильтрация плохо загруженных страниц и аномально бедного контента;
- анализ лемм и N-грамм по зонам `Title`, `H1`, `H2–H6`, основному тексту и
  ссылкам;
- сравнение своей страницы, медианы и каждого конкурента;
- три метрики страницы: TF-IDF ключей, взвешенный охват и взвешенная плотность;
- стоп-слова, стоп-фразы и предустановленный список шумовых терминов;
- графики распределения, таблицы и три синхронных облака слов;
- пересчёт ключей и стоп-термов по сохранённому корпусу без повторной загрузки;
- опциональные семантические связи через отдельный локальный spaCy-сервис.

Основной отчёт работает без Python, Docker, Firecrawl, spaCy и внешней LLM.
Недоступность модуля связей не ломает уже рассчитанный отчёт.

## Что потребуется

| Компонент | Обязателен | Назначение |
| --- | --- | --- |
| Node.js `>=22.13.0` и npm | да | веб-приложение и основной анализ |
| XMLRiver | для автоматического поиска | поисковая выдача и список конкурентов |
| Firecrawl | нет | fallback для URL, которые не удалось нормально загрузить |
| Docker Compose | нет | рекомендуемый запуск spaCy |
| Python 3.12 | нет | нативный запуск spaCy |

Поддерживаются 64-битные Windows 10/11, современные Linux и macOS.

Проверьте окружение:

```text
node --version
npm --version
```

## Быстрый старт

### 1. Получите проект

```bash
git clone https://github.com/mekotenkov-ux/bar-relevance-analyzer.git
cd bar-relevance-analyzer
npm ci
```

Без Git можно выбрать **Code → Download ZIP** на странице репозитория,
распаковать архив и открыть терминал в папке с `package.json`.

### 2. Создайте локальную конфигурацию

Windows PowerShell:

```powershell
Copy-Item env.example .dev.vars
```

Linux или macOS:

```bash
cp env.example .dev.vars
```

`.dev.vars` уже исключён из Git. Шаблон настроен на локальный
`SITE_URL=http://localhost:3000`. Для первого запуска другие значения можно не
заполнять: данные XMLRiver разрешено ввести прямо в интерфейсе, а Firecrawl и
spaCy оставить выключенными.

### 3. Запустите БАР

```bash
npm run dev
```

Откройте адрес, который напечатал сервер. Обычно это
<http://localhost:3000/analyzer>. Для остановки нажмите `Ctrl+C`.

## Первый анализ

1. Откройте `/analyzer`.
2. В блоке **Доступ XMLRiver** введите свой ID и ключ либо заранее настройте их
   на сервере.
3. Укажите запрос, поисковую систему, регион и нужное количество конкурентов.
4. Вставьте URL своей страницы или переключитесь в режим **Вставить текст**.
5. Нажмите **Найти и проанализировать**.

XMLRiver credentials, введённые в интерфейсе, хранятся только в
`sessionStorage` текущей вкладки. На общем компьютере после работы закройте
вкладку целиком.

## Конфигурация

Безопасный пример всех переменных находится в [`env.example`](env.example).

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `SITE_URL` | для публикации | Доверенный канонический origin, например `https://bar.example.com`. |
| `XMLRIVER_USER` | нет | Серверный ID XMLRiver. |
| `XMLRIVER_KEY` | нет | Серверный ключ XMLRiver. |
| `FIRECRAWL_API_KEY` | нет | Firecrawl fallback для недоступных URL и заглушек. |
| `TRIPLET_ENGINE` | нет | `spacy` для текущего движка связей. |
| `TRIPLET_SPACY_URL` | нет | Адрес spaCy-сервиса; локально `http://127.0.0.1:8092`. |
| `TRIPLET_SPACY_TIMEOUT_MS` | нет | Таймаут отдельного этапа связей. |
| `TRIPLET_SPACY_MAX_REQUEST_CHARACTERS` | нет | Аварийный транспортный guard, а не лимит строк отчёта. |

Для `npm run dev` используйте игнорируемый `.dev.vars`. При `npm start`
передавайте значения через `process.env`, secret manager либо локальный
игнорируемый `.env.production.local`.

Не добавляйте реальные ключи в `env.example`, исходный код, Docker-образы,
логи, issues, pull requests или build artifacts.

### XMLRiver

Есть два режима:

- **BYOK в браузере** — оставьте `XMLRIVER_USER` и `XMLRIVER_KEY` пустыми и
  введите credentials в интерфейсе. Это рекомендуемый вариант для локальной
  работы.
- **Серверный ключ** — заполните переменные и перезапустите приложение. На
  публичном сервере посетители смогут расходовать этот ключ через backend,
  поэтому обязательны авторизация, квоты, rate limiting и бюджет.

Для обратной совместимости поддерживается `XMLRIVER=user:key`, но две отдельные
переменные понятнее и безопаснее обслуживать.

### Firecrawl

Добавьте ключ и перезапустите приложение:

```dotenv
FIRECRAWL_API_KEY=ваш_ключ
```

БАР всегда сначала выполняет обычный HTTP-запрос. Firecrawl вызывается только
после ошибки либо обнаружения низкокачественной антибот-страницы и только если
пользователь включил соответствующую опцию.

При fallback-загрузке URL и содержимое страницы обрабатываются сторонним
сервисом Firecrawl. Наличие ключа не гарантирует обход любой защиты: плохая
заглушка всё равно будет исключена из анализа.

## Семантические связи через spaCy

Модуль необязателен, запускается отдельно и включается пользователем после
основного анализа. Готовая конфигурация поддерживает русский
`ru_core_news_sm` и английский `en_core_web_sm`.

### Docker — рекомендуемый вариант

```bash
docker compose -f services/triplets-symbolic/docker-compose.yml up --build -d
```

Проверка готовности:

```bash
curl http://127.0.0.1:8092/healthz
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8092/healthz
```

Ожидаемый ответ содержит `"ok": true` и `"engine": "spacy"`.

Управление контейнером:

```bash
docker compose -f services/triplets-symbolic/docker-compose.yml logs -f spacy
docker compose -f services/triplets-symbolic/docker-compose.yml down
```

<details>
<summary>Нативный запуск через Python 3.12</summary>

Windows PowerShell:

```powershell
py -3.12 -m venv services/triplets-symbolic/.venv
services\triplets-symbolic\.venv\Scripts\python.exe -m pip install -r services/triplets-symbolic/requirements-spacy.txt
node services/triplets-symbolic/start.mjs
```

Linux или macOS:

```bash
python3.12 -m venv services/triplets-symbolic/.venv
services/triplets-symbolic/.venv/bin/python -m pip install -r services/triplets-symbolic/requirements-spacy.txt
node services/triplets-symbolic/start.mjs
```

Последняя команда занимает терминал. Веб-приложение запускайте во втором
терминале.

</details>

Настройки веб-приложения:

```dotenv
TRIPLET_ENGINE=spacy
TRIPLET_SPACY_URL=http://127.0.0.1:8092
TRIPLET_SPACY_TIMEOUT_MS=900000
TRIPLET_SPACY_MAX_REQUEST_CHARACTERS=128000000
```

> Не публикуйте порт `8092` напрямую в интернет. Встроенный сервис рассчитан на
> loopback и не имеет собственной аутентификации или rate limiting. Для
> отдельного CPU-сервера используйте приватную сеть либо защищённый HTTPS reverse
> proxy.

Подробный контракт сервиса находится в
[`services/triplets-symbolic/README.md`](services/triplets-symbolic/README.md).
LLM-прототип сохранён только как отключённый эксперимент в
[`experiments/triplets-llm`](experiments/triplets-llm).

## Production self-hosting

Для локальной проверки production-режима создайте конфигурацию до сборки.

Windows PowerShell:

```powershell
Copy-Item env.example .env.production.local
```

Linux или macOS:

```bash
cp env.example .env.production.local
```

Укажите корректный `SITE_URL` и необходимые server-side переменные, затем:

```bash
npm ci
npm run build
npm start
```

На реальном хостинге используйте переменные окружения или secret manager, а не
файлы с ключами. Приложению нужен исходящий HTTPS-доступ к XMLRiver, Firecrawl и
анализируемым страницам.

Перед открытием общего доступа:

1. включите HTTPS и авторизацию;
2. ограничьте частоту, параллелизм, длительность и размер запросов к `/api/*`;
3. задайте квоты, дневной бюджет и аварийное отключение платных API;
4. проверьте максимальный корпус на лимитах памяти и времени платформы;
5. добавьте request ID, безопасные структурированные логи и мониторинг ошибок;
6. разверните spaCy в приватной сети или оставьте модуль выключенным;
7. не публикуйте служебные порты и локальные env-файлы.

## Данные и безопасность

- Backend по умолчанию stateless: отчёт и snapshot возвращаются в браузер.
- Интерфейс пытается сохранить текущий отчёт в `sessionStorage`. Большой отчёт
  может не сохраниться при исчерпании браузерной квоты.
- При пересчёте ключей и построении связей используется сохранённый корпус без
  повторной загрузки страниц.
- XMLRiver получает поисковый запрос; Firecrawl получает URL и содержимое только
  fallback-страниц.
- Анализируемые URL, HTML, redirects, API-ответы и snapshots считаются
  недоверенным вводом.

Никогда не коммитьте `.env*`, `.dev.vars*`, credentials, API-ключи, токены или
приватное содержимое анализируемых страниц. Если ключ попал в commit, artifact,
лог или скриншот, немедленно отзовите его у провайдера и создайте новый.

О проблемах безопасности сообщайте по инструкции в [SECURITY.md](SECURITY.md).

## Разработка и правила для AI-агентов

### Команды

| Команда | Назначение |
| --- | --- |
| `npm ci` | установить точные версии из lock-файла |
| `npm run dev` | запустить локальную разработку |
| `npm run typecheck` | проверить TypeScript |
| `npm run lint` | проверить стиль и типовые ошибки |
| `npm test` | запустить регрессионные тесты |
| `npm run build` | собрать production-версию |
| `npm run check` | typecheck, lint, build, тесты и Python syntax check |
| `npm start` | запустить уже собранную production-версию |

Для полного `npm run check` команда `python` должна быть доступна в терминале.
Устанавливать spaCy и модели для syntax check не требуется.

После обновления проекта:

```bash
git pull
npm ci
npm run check
```

### Карта проекта

| Путь | Назначение |
| --- | --- |
| `app/analyzer/` | форма, состояние и интерактивный отчёт |
| `app/api/search-competitors/` | поиск конкурентов через XMLRiver |
| `app/api/analyze-run/` | основной анализ и пересчёт snapshot |
| `app/api/analyze-triplets/` | отдельный этап семантических связей |
| `lib/semantic-analysis.ts` | загрузка, очистка, морфология, зоны и метрики |
| `lib/semantic-triplets.ts` | подготовка корпуса для связей |
| `lib/default-stop-terms.ts` | предустановленные стоп-термы |
| `lib/cloud-layout.ts` | детерминированная раскладка облаков |
| `services/triplets-symbolic/` | локальный spaCy backend RU/EN |
| `tests/` | контрактные и регрессионные тесты |

Архитектура и строгие контракты:

- [общая архитектура](docs/ARCHITECTURE.md);
- [контракт детерминированных связей](docs/deterministic-triplets-contract.md);
- [benchmark семантических связей](docs/triplets-symbolic-benchmark.md).

### Правила для AI-агентов

Если проект изменяет кодовый агент, он обязан:

1. **Не читать и не выводить секреты.** Запрещено открывать, парсить, печатать,
   логировать или передавать в контекст содержимое `.env`, `.env.*`,
   `.dev.vars` и `.dev.vars.*`. Имена переменных брать только из
   `env.example`.
2. **Не менять аналитику побочным эффектом.** Формулы, пороги, округление,
   нормализацию и смысл метрик менять только по явной продуктовой задаче и вместе
   с регрессионными тестами.
3. **Сохранять детерминизм.** Одинаковый корпус и snapshot должны давать
   одинаковые значения и порядок строк.
4. **Считать внешние данные недоверенными.** Не ослаблять защиту URL, redirect,
   локальных/metadata-адресов, входных размеров и SSRF без отдельного security
   review.
5. **Не повторно загружать корпус.** Пересчёт ключей, стоп-термов и связей
   выполняется только из snapshot v5, сохраняет `snapshot.id` и не вызывает
   XMLRiver, обычную загрузку страниц или Firecrawl.

Инварианты аналитики:

- термы, леммы и N-граммы с количеством меньше `1` в отчёт не попадают;
- отображаемые вхождения целые, «У нас» и «Ориентир» округляются вверх;
- косинусное сходство применяется только к похожести N-грамм на ключи, но не как
  оценка сайта;
- TF-IDF ключей, взвешенный охват и взвешенная плотность остаются тремя
  отдельными метриками;
- стоп-слово исключает лемму и все фразы с ней, стоп-фраза — совпадающую фразу;
- зональный анализ согласован для `all`, `title`, `h1`, `text`, `h2-h6` и `a`;
- ошибка spaCy не должна ломать основной отчёт.

Перед pull request агент или разработчик должен:

1. проверить `git status` и исключить секреты, кеши, модели, env-файлы и artifacts;
2. добавить регрессионный тест для каждого изменения поведения;
3. синхронно обновить UI-справку, README и `CHANGELOG.md`, если изменился
   пользовательский смысл;
4. выполнить `npm run check`;
5. для изменений spaCy выполнить релевантный diagnostic из README сервиса;
6. сохранить стандартную MIT-лицензию и корректные credits upstream-проекта.

## Частые проблемы

<details>
<summary><code>node</code>, <code>npm</code> или PowerShell не запускаются</summary>

Установите Node.js `>=22.13.0`, закройте все окна терминала и откройте новое.

Если PowerShell блокирует `npm.ps1`, не меняйте системную политику: используйте
`npm.cmd`.

```powershell
npm.cmd ci
npm.cmd run dev
```

</details>

<details>
<summary>Порт веб-приложения занят</summary>

```bash
npm run dev -- --port 3001
```

Откройте <http://localhost:3001/analyzer>. Если используется `SITE_URL`, укажите
тот же origin.

</details>

<details>
<summary>XMLRiver или Firecrawl не подключается</summary>

- проверьте ID, ключ, баланс, разрешения и случайные пробелы;
- перезапустите приложение после изменения `.dev.vars`;
- для XMLRiver попробуйте BYOK-ввод через интерфейс;
- для Firecrawl проверьте точное имя `FIRECRAWL_API_KEY`;
- откройте `/api/search-competitors`: ответ показывает только
  `serverConfigured` и `firecrawlConfigured`, не раскрывая секреты;
- проверьте исходящий HTTPS-доступ.

</details>

<details>
<summary>spaCy показывает <code>unavailable</code> или порт 8092 занят</summary>

1. Проверьте <http://127.0.0.1:8092/healthz>.
2. Убедитесь, что процесс или контейнер запущен.
3. Проверьте `TRIPLET_SPACY_URL` и перезапустите веб-приложение.
4. Для Python-варианта устанавливайте зависимости через `.venv`, а не глобальный
   `pip`.
5. Если health-check уже отвечает, второй экземпляр сервиса не нужен.

Недоступность spaCy не мешает пользоваться основным отчётом.

</details>

<details>
<summary>Анализ долгий или не хватает памяти</summary>

- временно уменьшите количество конкурентов;
- выключите семантические связи;
- не запускайте много тяжёлых отчётов одновременно;
- проверьте доступную память Docker и исходящие сетевые запросы;
- для serverless-платформ проверьте лимиты времени, памяти и размера ответа.

</details>

## Участие в проекте

Перед pull request прочитайте [CONTRIBUTING.md](CONTRIBUTING.md).

- ошибки и предложения: GitHub Issues;
- безопасные отчёты: [SECURITY.md](SECURITY.md);
- помощь с использованием: [SUPPORT.md](SUPPORT.md);
- история изменений: [CHANGELOG.md](CHANGELOG.md);
- сторонние компоненты: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Авторство и лицензия

- школа: [SEO Мясо](https://seomeat.ru/);
- создатель: [Максим Котенков](https://t.me/seokotenkov);
- Telegram: [@seokotenkov](https://t.me/seokotenkov);
- лицензия: [MIT](LICENSE);
- credits: [AUTHORS](AUTHORS), [ATTRIBUTION.md](ATTRIBUTION.md), [NOTICE](NOTICE).

Проект можно использовать, изменять, переименовывать и распространять по
стандартной MIT License при сохранении copyright и permission notice из
`LICENSE` в копиях или существенных частях программы.

Credits школы и создателя сохраняются как политика сопровождения исходного
репозитория. Это не скрытый watermark и не дополнительное лицензионное
ограничение для форков.
