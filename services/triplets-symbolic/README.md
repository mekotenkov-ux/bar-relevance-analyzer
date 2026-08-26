# Детерминированные семантические связи БАР

**spaCy** — рабочий локальный backend опции «Семантические связи». **Stanza**
остаётся контрольным движком для сравнительных прогонов. Модуль не использует LLM
и не влияет на основной отчёт БАР при ошибке или недоступности.

Алгоритм:

1. получает полный сохранённый корпус и все его леммы, биграммы и триграммы,
   включая сущности за пределами компактных таблиц отчёта;
2. лемматизирует предложения и определяет части речи и синтаксические зависимости;
3. сопоставляет самые длинные формы терминов с позициями токенов;
4. строит только синтаксически подтверждённые связи «субъект → предикат → объект»;
5. объединяет одинаковые связи и оставляет те, у которых есть минимум два разных предложения-доказательства.

Одинаковая сущность может иметь несколько исходящих и входящих связей. Повтор одной связи внутри одного предложения считается один раз.

## Рабочий HTTP-сервис spaCy

Самый короткий кроссплатформенный запуск — через Docker. Порт публикуется
только на loopback-интерфейсе компьютера:

```bash
docker compose -f services/triplets-symbolic/docker-compose.yml up --build
```

Не меняйте привязку `127.0.0.1` на публичный интерфейс без отдельного reverse
proxy, TLS, авторизации и ограничения запросов.

Для запуска без Docker установите лёгкие русскую и английскую модели в
отдельное окружение Python 3.12:

```powershell
py -3.12 -m venv services/triplets-symbolic/.venv
services\triplets-symbolic\.venv\Scripts\python.exe -m pip install -r services/triplets-symbolic/requirements-spacy.txt
node services/triplets-symbolic/start.mjs
```

Контракт API:

- `GET http://127.0.0.1:8092/healthz` — готовность процесса;
- `POST http://127.0.0.1:8092/v1/triplets` — единый JSON корпуса;
- `min_support` принудительно не меньше `2`;
- старые продуктовые срезы на 128/512 строк не применяются; аварийный guard
  настраивается через `TRIPLET_SPACY_MAX_RELATIONS` (по умолчанию 25 000);
- входной аварийный guard настраивается через
  `TRIPLET_SPACY_MAX_REQUEST_BYTES` (по умолчанию 128 МБ);
- модель загружается один раз на язык и переиспользуется между запросами.

В корневом `.dev.vars` веб-приложения:

```dotenv
TRIPLET_ENGINE=spacy
TRIPLET_SPACY_URL=http://127.0.0.1:8092
TRIPLET_SPACY_TIMEOUT_MS=900000
TRIPLET_SPACY_MAX_REQUEST_CHARACTERS=128000000
```

Для самого Python-сервиса при необходимости можно переопределить
`TRIPLET_SPACY_MAX_REQUEST_BYTES=128000000` и
`TRIPLET_SPACY_MAX_RELATIONS=25000`. Это только аварийные guards от повреждённого
или чужого входа; обычный результат внутри этих границ не обрезается.

## Формат диагностического запуска

```powershell
$env:PYTHONPATH="services/triplets-symbolic"
python services/triplets-symbolic/cli.py services/triplets-symbolic/fixtures/seo-ru.json --engine spacy
python services/triplets-symbolic/cli.py services/triplets-symbolic/fixtures/seo-ru.json --engine stanza
```

Результат содержит позиции субъекта, сказуемого и объекта в токенах и символах, количество подтверждений, число документов и примеры предложений.

`worker.py` принимает тот же JSON из stdin и удобен для диагностики без HTTP.

## Установка моделей

Рекомендуемый изолированный Python — 3.12. Только рабочий spaCy-backend
зафиксирован в `requirements-spacy.txt`; полный сравнительный набор со Stanza — в
`requirements.txt`.

```powershell
python -m pip install -r services/triplets-symbolic/requirements.txt
python services/triplets-symbolic/download_stanza_models.py ru en
```

Веса Stanza скачиваются в локальную папку `.stanza-models` и не входят в MIT-дистрибутив проекта. Затем единый сравнительный прогон запускается так:

```powershell
python services/triplets-symbolic/benchmark.py
```

Для реального сохранённого отчёта БАР сначала строится общий вход. Production API
дополняет словарь непосредственно из предложений; диагностический exporter берёт
все доступные в сохранённом файле леммы и N-граммы, а не только строки с высокой
важностью:

```powershell
python services/triplets-symbolic/export_bar_report.py report.json corpus.json
python services/triplets-symbolic/benchmark.py --fixture corpus.json
```
