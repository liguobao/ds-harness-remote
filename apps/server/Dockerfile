FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm --filter @dsh-remote/server... install --frozen-lockfile --ignore-scripts

COPY packages/protocol/src packages/protocol/src
COPY packages/protocol/tsconfig.json packages/protocol/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/server/web apps/server/web
COPY apps/server/tsconfig.json apps/server/tsconfig.json
RUN pnpm --filter @dsh-remote/protocol build \
    && pnpm --filter @dsh-remote/server build \
    && pnpm --filter @dsh-remote/server deploy --prod /out

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DSH_SERVER_HOST=0.0.0.0 \
    DSH_SERVER_PORT=8080 \
    DSH_SERVER_DATA_FILE=/data/state.json
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.DSH_SERVER_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
