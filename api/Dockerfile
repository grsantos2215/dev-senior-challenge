FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod=false

COPY . .

EXPOSE 3000

CMD ["pnpm", "start:dev"]
