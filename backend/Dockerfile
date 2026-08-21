FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @dictate/backend --include-workspace-root=false
COPY backend backend
RUN npm run build --workspace @dictate/backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace @dictate/backend --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3000
CMD ["node", "backend/dist/src/server.js"]
