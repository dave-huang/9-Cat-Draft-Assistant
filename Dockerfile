# Single image: builds the web app + API server, then serves both from one Node process.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && NODE_ENV=production pnpm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# The server is a self-contained esbuild bundle; it needs only its dist and the built web files.
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /app/artifacts/draft-assistant/dist/public ./artifacts/draft-assistant/dist/public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
