# tv-webhook/Dockerfile
FROM node:20-alpine

# Install curl for the healthcheck (alpine's busybox wget can be finicky)
RUN apk add --no-cache curl

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package*.json ./
RUN npm ci

# Copy the source code
COPY . .

# Build the TypeScript sources inside the image
RUN npm run build

# Strip dev dependencies after build to keep image lean
RUN npm prune --production

# These match your compose envs
ENV PORT=80
EXPOSE 80

CMD ["node", "dist/bot.js"]
