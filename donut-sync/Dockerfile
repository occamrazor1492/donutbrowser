ARG NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine

FROM ${NODE_IMAGE} AS builder

WORKDIR /build
COPY donut-sync/package.json donut-sync/tsconfig.json donut-sync/tsconfig.build.json ./
COPY donut-sync/prisma/ prisma/
COPY donut-sync/src/ src/
RUN npm install
RUN npm run db:generate
RUN npm run build
RUN npm prune --omit=dev

FROM ${NODE_IMAGE}

WORKDIR /app
COPY --from=builder /build/package.json .
COPY --from=builder /build/dist/ dist/
COPY --from=builder /build/node_modules/ node_modules/
COPY --from=builder /build/prisma/ prisma/

ENV NODE_ENV=production
EXPOSE 12342

USER node
CMD ["sh", "-c", "npm run db:migrate && node dist/main"]
