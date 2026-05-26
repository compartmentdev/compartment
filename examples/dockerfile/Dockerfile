FROM node:24.15.0-alpine
WORKDIR /app
COPY server.mjs ./server.mjs
EXPOSE 3000
USER 10001:10001
CMD ["node", "server.mjs"]
