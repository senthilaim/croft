# Build context: repository root (the frontend depends on the shared-types workspace package).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY frontend/package.json frontend/
RUN rm -f package-lock.json && npm install --no-audit --no-fund --workspace=frontend --workspace=@croft/shared-types --include-workspace-root
COPY packages/shared-types packages/shared-types
COPY frontend frontend
RUN npm run build -w @croft/shared-types && npm run build -w frontend

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared-types packages/shared-types
COPY --from=build /app/frontend frontend
USER node
WORKDIR /app/frontend
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
