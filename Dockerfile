FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY .harness/ .harness/
COPY skills/ skills/
COPY harness.yml ./

FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ sqlite3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/.harness ./.harness
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/harness.yml ./harness.yml

RUN mkdir -p data/sqlite data/duckdb data/logs
RUN touch data/logs/scrape-log.jsonl data/logs/analysis-log.jsonl data/logs/prediction-log.jsonl

EXPOSE 3001

# Use direct path to tsx binary to avoid npx download on cold start.
# tsx is bundled in node_modules via npm ci.
CMD ["node", "node_modules/.bin/tsx", "src/viz/data-api.ts"]
