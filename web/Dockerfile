# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
ENV NODE_ENV=development
ENV CHOKIDAR_USEPOLLING=true
COPY . .
EXPOSE 5173
CMD ["pnpm", "run", "dev", "--host", "0.0.0.0", "--strictPort"]