FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm install --no-save --omit=dev esbuild@0.25.9 \
  && for file in public/app.js public/platform-player.js public/tizen-loader.js public/webos-remote.js public/pro-ui.js public/webos-safe-bootstrap.js public/webos-remote-safe.js; do \
       cp "$file" "/tmp/$(basename "$file")"; \
       ./node_modules/.bin/esbuild "/tmp/$(basename "$file")" --target=chrome79 --outfile="$file"; \
     done \
  && rm -f /tmp/app.js /tmp/platform-player.js /tmp/tizen-loader.js /tmp/webos-remote.js /tmp/pro-ui.js /tmp/webos-safe-bootstrap.js /tmp/webos-remote-safe.js
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
