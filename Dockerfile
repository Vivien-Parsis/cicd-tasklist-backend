FROM node:22-slim

WORKDIR /app

RUN useradd -m appuser && chown -R appuser /app
USER appuser

COPY ./package.json .
COPY package-lock.json .

RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

CMD [ "npm", "run", "start"]