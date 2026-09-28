FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run compile && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 CHAIN_ID=11155111
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
COPY server ./server
RUN mkdir deployments && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/index.mjs"]
