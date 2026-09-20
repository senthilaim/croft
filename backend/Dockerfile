# Build context: repository root (the backend depends on the shared-types workspace package).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY backend/package.json backend/
RUN npm install --no-audit --no-fund --workspace=backend --workspace=@croft/shared-types --include-workspace-root
COPY packages/shared-types packages/shared-types
COPY backend backend
RUN npm run build -w @croft/shared-types && npm run build -w backend

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared-types packages/shared-types
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/package.json backend/package.json
USER node
WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "dist/main"]
