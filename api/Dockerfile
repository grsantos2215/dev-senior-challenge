FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod=false

COPY . .

# generate antes de build: o client gerado vive em src/generated e o tsc precisa dele
RUN pnpm prisma generate

# build antes do CMD: start:prod roda `node dist/main`, que não existe numa imagem limpa
RUN pnpm build

EXPOSE 3000

# migrate deploy no boot, e não como passo de build: a imagem é a mesma para todos os
# ambientes, e migrar no build publicaria o schema junto com a tag.
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm start:prod"]