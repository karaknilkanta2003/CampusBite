# Single container: builds the web app, then serves it and the API from one Node process.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build --workspace web && npm test --workspace server

FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/campusbite.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
VOLUME ["/data"]
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
CMD ["node", "src/index.ts"]
