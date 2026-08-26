# Первая публикация на GitHub

Этот чек-лист нужен владельцу исходного проекта. Он отделяет подготовку
репозитория от необратимых публичных действий.

## 1. Финальная локальная проверка

```bash
npm ci
npm run check
git diff --check
git status --short
```

Убедитесь, что в будущий commit не входят `.env*`, `.dev.vars*`, `dist`,
`node_modules`, Python-модели, локальные результаты и архивы из `artifacts`.
Если любой ключ когда-либо попадал в опубликованный commit или переданный build
artifact, сначала отзовите его у провайдера и выпустите новый.

## 2. Первый OSS-commit

Сначала проверьте, что Git использует публичное имя и email нужного GitHub-
аккаунта, а не служебную локальную учётную запись:

```bash
git config user.name
git config user.email
```

При необходимости задайте правильные значения только для этого репозитория
через `git config user.name "..."` и `git config user.email "..."`. Затем
проверьте diff и зафиксируйте подготовленное состояние:

```bash
git add -A
git commit -m "Prepare BAR for open-source release"
```

Не используйте `--no-verify` и не коммитьте изменения, которые не просмотрены.

## 3. Создание публичного репозитория

Рекомендуемый slug: `bar-relevance-analyzer`. Через GitHub CLI:

```bash
gh repo create bar-relevance-analyzer --public --source=. --remote=origin --push
```

Команда создаёт внешний публичный ресурс и должна запускаться только владельцем
аккаунта после проверки имени, организации и состава commit. Альтернатива —
создать пустой public repository в интерфейсе GitHub, затем выполнить команды,
которые GitHub покажет для добавления `origin` и отправки ветки `main`.

## 4. Настройки GitHub

После первой отправки:

1. включите Issues и Private Vulnerability Reporting;
2. включите Dependabot alerts, dependency graph, CodeQL default setup, secret
   scanning и push protection, если они доступны для выбранного аккаунта;
3. защитите `main`: pull request, успешный CI и запрет force-push;
4. добавьте topics `seo`, `nlp`, `tf-idf`, `semantic-analysis`, `self-hosted`;
5. загрузите `public/og.png` как Social preview репозитория;
6. убедитесь, что GitHub определил лицензию как MIT;
7. проверьте ссылки и инструкции из README на чистом clone.

## 5. Первый tag и GitHub Release

После успешного CI на `main`:

```bash
git tag -a v0.1.0 -m "BAR 0.1.0 open-source preview"
git push origin v0.1.0
gh release create v0.1.0 --title "BAR 0.1.0" --notes-file CHANGELOG.md
```

Не прикладывайте локальный `dist` или модели spaCy к Release без отдельной
воспроизводимой сборки, проверки секретов и инвентаризации лицензий.
