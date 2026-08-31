# 分析 API サーバー（analytics/server）
# build context はリポジトリ root（docker-compose.analytics.yml 参照）。
# 既存 server/ の集計定義（routes/reports.js 等）を同一イメージに同梱して require するため、
# server/ と analytics/server の両方の依存をインストールする。
FROM node:20-alpine
WORKDIR /app

# 依存インストール（package*.json のみ先に COPY してレイヤーキャッシュを効かせる）
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
COPY analytics/server/package*.json ./analytics/server/
RUN cd analytics/server && npm install --omit=dev

# ソース
COPY server ./server
COPY analytics/db ./analytics/db
COPY analytics/server ./analytics/server

WORKDIR /app/analytics/server
EXPOSE 3101
CMD ["node", "index.js"]
