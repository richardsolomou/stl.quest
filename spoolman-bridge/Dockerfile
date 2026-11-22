# syntax=docker/dockerfile:1
FROM node:24-alpine
WORKDIR /app
COPY bridge.ts ./
USER node
ENV NODE_ENV=production
CMD ["node", "bridge.ts"]
