FROM node:24.15.0-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts \
  && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY server.mjs.in ./server.mjs

USER node
CMD ["node", "server.mjs"]

