# БАР — бесплатный анализ релевантности

![БАР — бесплатный анализ релевантности](public/og.png)

[![Школа SEO Мясо](https://img.shields.io/badge/Школа-SEO_Мясо-d9ff43?style=for-the-badge&labelColor=151711)](https://seomeat.ru/)
[![Создатель @seokotenkov](https://img.shields.io/badge/Создатель-@seokotenkov-7458e8?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/seokotenkov)
[![MIT License](https://img.shields.io/badge/license-MIT-f3f3ee?style=for-the-badge&labelColor=151711)](LICENSE)

БАР — self-hosted open-source инструмент для сравнения страницы с конкурентами
из поисковой выдачи. Он **сделан в школе [SEO Мясо](https://seomeat.ru/)**.
Создатель — **[Максим Котенков](https://t.me/seokotenkov)**. БАР строит отчёты
по леммам, N-граммам, HTML-зонам, распределению терминов, облакам слов и объёму
текста.

Проект распространяется по стандартной [лицензии MIT](LICENSE): его можно использовать, изменять,
переименовывать и распространять, сохраняя copyright и текст лицензии в копиях
или существенных частях программы.

> Статус проекта: pre-release. БАР уже пригоден для локального использования и
> самостоятельного развёртывания, но перед открытием публичного сервера оператору
> необходимо настроить секреты, лимиты запросов и наблюдаемость.

## Возможности

- поиск конкурентов через XMLRiver;
- загрузка страниц обычным HTTP-запросом;
- опциональный Firecrawl fallback только для недоступных страниц и заглушек;
- фильтрация антибот-страниц и аномально бедного контента;
- анализ лемм и N-грамм по зонам `Title`, `H1`, `H2–H6`, основному тексту и
  ссылкам;
- сравнение собственной страницы, медианы и отдельных конкурентов;
- стоп-слова и стоп-фразы;
- локальный пересчёт отчёта по сохранённому корпусу;
- опциональные семантические связи через локальный spaCy-сервис.

Основной отчёт не требует Python или внешней LLM. Семантические связи выключены
по умолчанию и не мешают работе отчёта, если spaCy недоступен.

## English summary

BAR is a self-hosted relevance analyzer for comparing a page with organic-search
competitors. The web application is primarily documented in Russian. The optional
spaCy relation service currently ships with **Russian and English models only**.
XMLRiver and Firecrawl are bring-your-own-key integrations; no service credentials
are bundled with the repository.

## Требования

- Node.js `>=22.13.0`;
- npm, входящий в поставку Node.js;
- собственные данные доступа XMLRiver для автоматического поиска конкурентов;
- опционально Python 3.12 для семантических связей; Python также нужен только
  разработчикам для полного `npm run check`.

## Быстрый локальный запуск

После клонирования репозитория:

```bash
cd bar-relevance-analyzer
npm ci
cp env.example .dev.vars
npm run dev
```

В PowerShell вместо `cp`:

```powershell
Copy-Item env.example .dev.vars
```

Откройте адрес, который выведет dev-сервер. Для первого запуска достаточно
добавить XMLRiver ID и ключ в интерфейсе; Firecrawl и spaCy необязательны.

Подробные инструкции:

- [установка и настройка для человека](docs/INSTALL.md);
- [инструкция для кодового агента](AGENTS.md).

## Конфигурация

Для `npm run dev` локальные runtime-значения храните в игнорируемом `.dev.vars`.
При `npm start` используйте переменные процесса, secret manager либо локальный
игнорируемый `.env.production.local`. Не коммитьте реальные ключи и не добавляйте
их в Docker-образы или build artifacts.

| Переменная | Обязательна | Назначение |
| --- | --- | --- |
| `SITE_URL` | для публикации | Канонический доверенный origin для Open Graph, например `https://bar.example.com`. |
| `XMLRIVER_USER` | нет | Серверный ID XMLRiver. Можно не задавать и вводить BYOK-данные в интерфейсе. |
| `XMLRIVER_KEY` | нет | Серверный ключ XMLRiver. |
| `FIRECRAWL_API_KEY` | нет | Серверный ключ Firecrawl для fallback-загрузки. |
| `TRIPLET_ENGINE` | нет | `spacy` для текущего движка связей; используется только при включении опции. |
| `TRIPLET_SPACY_URL` | нет | Адрес spaCy-сервиса, локально `http://127.0.0.1:8092`. |
| `TRIPLET_SPACY_TIMEOUT_MS` | нет | Таймаут отдельного этапа связей. |
| `TRIPLET_SPACY_MAX_REQUEST_CHARACTERS` | нет | Аварийный транспортный guard, а не число строк отчёта. |

Полный пример находится в [`env.example`](env.example). Поддерживается также
объединённая XMLRiver-переменная `XMLRIVER` в формате `user:key`, но для новых
установок понятнее использовать две отдельные переменные.

### XMLRiver и Firecrawl: BYOK

Репозиторий не содержит оплаченных ключей.

- XMLRiver используется только для получения поисковой выдачи. Пользователь может
  ввести собственные credentials в интерфейсе; они сохраняются только в
  `sessionStorage` до закрытия вкладки.
- Серверные `XMLRIVER_USER` и `XMLRIVER_KEY` удобны для частной установки. На
  публичном сервере они делают платный API доступным посетителям через ваш backend,
  поэтому заранее добавьте авторизацию, квоты и rate limiting.
- Firecrawl вызывается только после неудачной обычной загрузки или обнаружения
  низкокачественной заглушки. URL и содержимое такой страницы обрабатываются
  сторонним сервисом Firecrawl.

На общем компьютере не сохраняйте личные credentials в браузере. Никогда не
прикладывайте ключи к issue, логам или скриншотам.

## Семантические связи через spaCy

Этот этап необязателен. В поставку входят конфигурации лёгких моделей только для
**русского (`ru_core_news_sm`) и английского (`en_core_web_sm`)**. Основной анализ
может работать с другими поддерживаемыми языками, но семантические связи для них
потребуют отдельной совместимой spaCy-модели и проверки качества.

### Windows

```powershell
py -3.12 -m venv services/triplets-symbolic/.venv
services\triplets-symbolic\.venv\Scripts\python.exe -m pip install -r services/triplets-symbolic/requirements-spacy.txt
node services/triplets-symbolic/start.mjs
```

### Linux/macOS

```bash
python3.12 -m venv services/triplets-symbolic/.venv
services/triplets-symbolic/.venv/bin/python -m pip install -r services/triplets-symbolic/requirements-spacy.txt
node services/triplets-symbolic/start.mjs
```

Или одинаково на любой платформе через Docker:

```bash
docker compose -f services/triplets-symbolic/docker-compose.yml up --build
```

В `.dev.vars` веб-приложения:

```dotenv
TRIPLET_ENGINE=spacy
TRIPLET_SPACY_URL=http://127.0.0.1:8092
TRIPLET_SPACY_TIMEOUT_MS=900000
TRIPLET_SPACY_MAX_REQUEST_CHARACTERS=128000000
```

Проверка локального процесса:

```bash
curl http://127.0.0.1:8092/healthz
```

> **Не выставляйте встроенный spaCy HTTP-сервис напрямую в интернет.** Он
> предназначен для loopback-соединения и сам не реализует аутентификацию. Для
> отдельного CPU-хоста используйте приватную сеть либо HTTPS reverse proxy с
> аутентификацией, ограничением размера запросов, очередью, rate limiting и
> firewall. До настройки защищённого канала оставьте модуль связей выключенным.

Подробности контракта и диагностических запусков:
[`services/triplets-symbolic/README.md`](services/triplets-symbolic/README.md).
Экспериментальный LLM-вариант сохранён отдельно в
[`experiments/triplets-llm`](experiments/triplets-llm) и не включается без явного
`TRIPLET_ENGINE=llm`.

Общий поток данных и границы компонентов описаны в
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Production self-hosting

Проверка production-сборки:

```bash
npm ci
npm run build
npm start
```

Для публичной установки одного успешного build недостаточно. Перед открытием
доступа:

1. передавайте XMLRiver, Firecrawl и NLP credentials через secret manager
   выбранной платформы, а не через репозиторий или сохранённый artifact;
2. ограничьте частоту, параллелизм, время и размер запросов к `/api/*`;
3. установите дневной бюджет и аварийное отключение платных API;
4. проверьте максимальный ожидаемый корпус на лимитах памяти и времени хостинга;
5. добавьте request ID, безопасные структурированные логи и мониторинг ошибок;
6. разверните spaCy отдельно и защищённо либо оставьте эту опцию выключенной;
7. используйте HTTPS и не публикуйте локальные служебные порты.

Приложению нужен исходящий HTTPS-доступ к XMLRiver, Firecrawl и анализируемым
страницам. Если платформа использует serverless runtime, отдельно проверьте её
ограничения на длительность, память, тело запроса и размер ответа.

## Хранение данных

По умолчанию БАР stateless на стороне сервера: отчёт и snapshot возвращаются в
браузер. Интерфейс пытается сохранить текущий отчёт в `sessionStorage`, поэтому
большой отчёт может не пережить закрытие или перезагрузку вкладки при исчерпании
браузерной квоты. Экспортируйте нужные таблицы до закрытия вкладки.

Если вы добавляете серверное хранение, самостоятельно определите TTL, удаление,
контроль доступа, резервное копирование и правила обработки содержимого страниц.

## Проверки

```bash
npm run check
```

Команда выполняет typecheck, lint, production build, набор Node.js-тестов и
проверку синтаксиса Python. Для неё нужен доступный интерпретатор `python`, но
устанавливать spaCy и его модели не требуется. Те же шаги запускаются в GitHub
Actions.

Для изменений spaCy дополнительно выполните диагностический прогон из
[`services/triplets-symbolic/README.md`](services/triplets-symbolic/README.md).

## Как помочь проекту

Перед pull request прочитайте [CONTRIBUTING.md](CONTRIBUTING.md). Ошибки и
предложения оформляйте через GitHub Issues; инструкции по безопасным отчётам — в
[SECURITY.md](SECURITY.md), по вопросам использования — в [SUPPORT.md](SUPPORT.md).
Изменения выпусков фиксируются в [CHANGELOG.md](CHANGELOG.md), сведения о прямых
сторонних компонентах — в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Порядок первой публикации владельцем описан в
[`docs/PUBLISHING.md`](docs/PUBLISHING.md).

Участники могут добавлять своё авторство к собственным изменениям. Условия MIT не
требуют сохранять название продукта, логотип или видимое упоминание в интерфейсе;
обязательное условие — сохранить copyright и permission notice из
[`LICENSE`](LICENSE) в копиях или существенных частях исходной программы.

## Авторство и лицензия

- исходный проект: [SEO Мясо](https://seomeat.ru/);
- создатель: [Максим Котенков (Maxim Kotenkov)](https://t.me/seokotenkov);
- Telegram: [@seokotenkov](https://t.me/seokotenkov);
- лицензия: [MIT](LICENSE);
- дополнительные сведения: [AUTHORS](AUTHORS), [ATTRIBUTION.md](ATTRIBUTION.md),
  [NOTICE](NOTICE).
