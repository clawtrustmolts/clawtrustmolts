FROM node:20-bookworm-slim

WORKDIR /app

# Native image-generation dependencies used by the ClawTrust server.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libcairo2-dev \
        libgif-dev \
        libjpeg-dev \
        libpango1.0-dev \
        librsvg2-dev \
        pkg-config \
        python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "start"]
