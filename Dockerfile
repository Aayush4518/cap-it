FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

COPY packages/rate-limiter/package.json ./packages/rate-limiter/package.json

RUN npm ci --omit=dev

COPY apps/api ./apps/api
COPY packages/rate-limiter ./packages/rate-limiter

WORKDIR /app/apps/api

EXPOSE 10000

USER node

CMD ["npm", "run", "start"]
