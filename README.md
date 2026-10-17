# Порядок

Личный to-do список: Express + TypeScript, PostgreSQL, React + Vite + shadcn/ui.

## Быстрый запуск в Docker

Нужны Git, Docker Engine / Docker Desktop с Linux containers и Compose v2. Для генерации окружения — Node.js 24 LTS либо контейнер Node.

```sh
npm run setup:env
docker compose up -d --build --wait --wait-timeout 180
```

Без локального Node.js первую команду можно заменить:

```sh
docker run --rm -v "${PWD}:/work" -w /work node:24-bookworm-slim node scripts/setup-env.mjs
```

Открыть [http://localhost:8080](http://localhost:8080) и зарегистрировать свой аккаунт. Предустановленных пользователей нет.

Скрипт создает `.env` со случайными паролями и не перезаписывает существующий файл. Пароли PostgreSQL в URL должны быть закодированы percent-encoding; генерируемые hex-пароли дополнительного кодирования не требуют. При ручном изменении пароля синхронизируйте `POSTGRES_PASSWORD` и `DATABASE_URL`. Изменение переменной не меняет пароль в уже созданной БД: для нее нужен `ALTER ROLE`.

```sh
docker compose ps
docker compose logs -f api
docker compose down
```
