FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN cp public/app.js /tmp/gate-app.js \
  && npm install --no-save --omit=dev esbuild@0.25.9 \
  && ./node_modules/.bin/esbuild /tmp/gate-app.js --target=chrome79 --outfile=public/app.js \
  && rm -f /tmp/gate-app.js
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
