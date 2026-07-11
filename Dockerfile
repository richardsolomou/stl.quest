FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
