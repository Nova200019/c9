FROM node:20-bullseye AS builder

ENV npm_config_fetch_timeout=600000
ENV npm_config_sharp_binary_host="https://npmmirror.com/mirrors/sharp"
ENV npm_config_sharp_libvips_binary_host="https://npmmirror.com/mirrors/sharp-libvips"

# Install build dependencies
RUN apt-get update && \
    apt-get install -y python3 make g++ ffmpeg tesseract-ocr libtesseract-dev libleptonica-dev pkg-config ca-certificates libvips-dev && \
    ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /usr/app-production
COPY package*.json ./

RUN npm install --fetch-timeout=600000

COPY index.html ./index.html
COPY vite.config.ts ./vite.config.ts
COPY tsconfig.json ./tsconfig.json
COPY tsconfig.node.json ./tsconfig.node.json
COPY postcss.config.js ./postcss.config.js
COPY tailwind.config.js ./tailwind.config.js
COPY eslint.config.mjs ./eslint.config.mjs
COPY public ./public
COPY src ./src
COPY backend ./backend
COPY serverUtils ./serverUtils
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

FROM node:20-bullseye

ENV FS_DIRECTORY=/data/
ENV TEMP_DIRECTORY=/temp/

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y ffmpeg tesseract-ocr libtesseract-dev libleptonica-dev pkg-config ca-certificates libvips42

WORKDIR /usr/app-production
COPY --from=builder /usr/app-production .

EXPOSE 8080
EXPOSE 3000
EXPOSE 80
CMD ["npm", "run", "start"]
