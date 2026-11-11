FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

COPY packages/rate-limiter/package.json ./packages/rate-limiter/package.json

RUN npm ci

COPY apps/api ./apps/api
COPY packages/rate-limiter ./packages/rate-limiter

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace=api"]
