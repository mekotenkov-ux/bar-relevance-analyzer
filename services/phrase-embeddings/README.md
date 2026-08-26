# Локальный сервис сходства фраз E5

Сервис подключает к БАР
[`intfloat/multilingual-e5-large-instruct`](https://huggingface.co/intfloat/multilingual-e5-large-instruct)
для сравнения N-грамм с пользовательскими ключами. Он работает локально на CPU,
не отправляет тексты во внешнее API и не используется как оценка релевантности
сайта.

Запросы кодируются с retrieval-инструкцией E5:

```text
Instruct: Retrieve semantically similar text
Query: <ключ>
```

Кандидаты кодируются без инструкции. Все эмбеддинги L2-нормализуются, поэтому
скалярное произведение в ответе является cosine similarity. Ограниченный
процессный LRU-кэш хранит векторы запросов и кандидатов раздельно: повторяющиеся
ключи не пересчитываются, когда большой список N-грамм отправляется чанками.
Проверенная revision модели по умолчанию закреплена на
`274baa43b0e13e37fafa6428dbc7938e62e5c439`; её можно осознанно заменить через
`PHRASE_EMBEDDINGS_REVISION`.

## Запуск без Docker

Рекомендуется Python 3.12 и отдельное окружение:

```powershell
py -3.12 -m venv services/phrase-embeddings/.venv
services\phrase-embeddings\.venv\Scripts\python.exe -m pip install -r services/phrase-embeddings/requirements.txt
node services/phrase-embeddings/start.mjs
```

На Linux/macOS путь к Python окружения —
`services/phrase-embeddings/.venv/bin/python`. Первый запуск скачивает модель в
игнорируемый Git каталог `work/hf-cache`; повторные запуски используют этот
кэш. До окончания загрузки и короткого warm-up порт не открывается, поэтому
успешный `healthz` означает, что модель действительно готова считать сходство.

## Docker

```bash
docker compose -f services/phrase-embeddings/docker-compose.yml up --build
```

Веса сохраняются в именованный volume `phrase-embedding-models`, а порт
публикуется только на `127.0.0.1`. Не публикуйте сервис в интернет без reverse
proxy, TLS, авторизации и собственного rate limit.

## API

Проверка готовности:

```http
GET http://127.0.0.1:8093/healthz
```

Ответ содержит точный model id, разрешённую Hugging Face revision, размерность и
устройство.

Пакетное сравнение:

```http
POST http://127.0.0.1:8093/v1/similarity
Content-Type: application/json

{
  "queries": ["курсы SEO", "обучение продвижению сайтов"],
  "candidates": ["SEO обучение", "семантическое ядро"]
}
```

Сокращённый ответ:

```json
{
  "ok": true,
  "model": "intfloat/multilingual-e5-large-instruct",
  "revision": "<commit>",
  "dimensions": 1024,
  "scores": [[0.94, 0.88], [0.81, 0.79]],
  "best": [
    {"query_index": 0, "score": 0.94},
    {"query_index": 0, "score": 0.81}
  ],
  "meta": {
    "normalized_embeddings": true,
    "score": "cosine",
    "score_layout": "scores[candidate_index][query_index]"
  }
}
```

Матрица всегда имеет ориентацию `scores[candidate_index][query_index]` и
сохраняет исходный порядок, включая повторяющиеся строки. `best` содержит один
лучший ключ для каждого кандидата; равенство разрешается в пользу первого ключа.

## Ограничения и настройка

Поддерживаемые имена переменных перечислены в [`env.example`](env.example):

- `PHRASE_EMBEDDINGS_THREADS`, `PHRASE_EMBEDDINGS_BATCH_SIZE` — нагрузка CPU и
  размер внутреннего batch;
- `PHRASE_EMBEDDINGS_CACHE_DIR`, `PHRASE_EMBEDDINGS_CACHE_SIZE` — каталог весов
  и число векторов в LRU-кэше;
- `PHRASE_EMBEDDINGS_LOCAL_FILES_ONLY=1` — полностью запретить обращения к
  Hugging Face после того, как модель уже появилась в локальном кэше;
- `PHRASE_EMBEDDINGS_MAX_REQUEST_BYTES`, `MAX_TEXTS`, `MAX_TEXT_CHARACTERS`,
  `MAX_TOTAL_CHARACTERS`, `MAX_PAIRS` — аварийные guards повреждённого входа;
- `PHRASE_EMBEDDINGS_MODEL` и `PHRASE_EMBEDDINGS_REVISION` — явная замена
  модели или закреплённой версии для диагностики.

Значения по умолчанию рассчитаны на отправку кандидатов чанками примерно по 512
строк. При 25 000 закэшированных 1024-мерных `float32`-векторах верхняя оценка
памяти самого LRU составляет около 100 МБ плюс служебные структуры.

## Проверки без скачивания модели

Контрактные тесты используют поддельный backend, поэтому не требуют Torch,
Sentence Transformers или доступа к сети:

```powershell
python -m unittest services/phrase-embeddings/test_server.py
python -m py_compile services/phrase-embeddings/server.py services/phrase-embeddings/test_server.py
```

## Живой diagnostic «курсы SEO»

После запуска настоящего сервиса выполните:

```powershell
python services/phrase-embeddings/diagnostic.py
```

Скрипт проверит `healthz`, отправит
[`fixtures/seo-courses.csv`](fixtures/seo-courses.csv) и напечатает кандидатов по
убыванию E5 cosine вместе с model revision. Можно передать стандартную выгрузку
таблицы N-грамм БАР с колонками `Фраза;Лучший ключ`:

```powershell
python services/phrase-embeddings/diagnostic.py --csv "C:\path\to\ngrams.csv" --output work/e5-live.json
```

Большая выборка отправляется чанками по 512 кандидатов. Все ключи повторяются в
каждом чанке намеренно: процессный LRU-кэш позволяет этим запросам не считать
эмбеддинги повторно.
