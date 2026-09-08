FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run ci

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/dev-server.mjs ./scripts/dev-server.mjs
EXPOSE 4173
CMD ["node", "scripts/dev-server.mjs", "dist", "4173"]
