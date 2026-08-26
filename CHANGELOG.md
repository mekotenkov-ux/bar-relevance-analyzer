# Changelog

Значимые изменения проекта будут фиксироваться в этом файле. После появления
первого tag проект будет использовать Semantic Versioning, насколько это возможно
для pre-release продукта.

## [Unreleased]

### Added

- self-hosted/open-source руководство в README;
- community-документы для вкладов, поддержки, безопасности и поведения;
- GitHub issue и pull request templates;
- сводка прямых сторонних компонентов и внешних интеграций.
- GitHub Actions CI, отдельные typecheck и Python syntax checks;
- Docker-конфигурация локального spaCy-сервиса с loopback-портом;
- архитектурная схема, инструкция первой GitHub-публикации и social preview БАР.

### Changed

- пользовательская установка, production-настройка и правила для AI-агентов
  объединены в один канонический README без дублирующей инструкции;
- обновлены React/RSC, Vinext, Vite, Cloudflare plugin и Wrangler;
- XMLRiver credentials перенесены из постоянного browser storage в данные
  текущей вкладки;
- конфигурация проекта отвязана от частного Sites project ID.

### Security

- задокументировано, что встроенный spaCy HTTP-сервис нельзя публиковать напрямую;
- добавлены рекомендации по BYOK, secret manager, квотам и очистке отчётов.
- Firecrawl и NLP secrets исключены из build vars и ожидаются только в runtime.

## История до публичных релизов

Ранее проект развивался без формализованных release tags. Эта история остаётся в
Git; задним числом ей не назначаются версии или даты.
