FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=builder /app/dist ./dist

RUN groupadd --system app \
  && useradd --system --gid app --create-home app \
  && mkdir -p /app/data \
  && chown -R app:app /app

USER app
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start"]
