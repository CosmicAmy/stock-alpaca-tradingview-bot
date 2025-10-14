# tv-webhook/Dockerfile
FROM node:20-alpine

# Install curl for the healthcheck (alpine's busybox wget can be finicky)
RUN apk add --no-cache curl

WORKDIR /app

# Install deps (use package*.json if you have lockfile)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of your app
COPY . .

# These match your compose envs
ENV PORT=80
EXPOSE 80

# If your entry is "node server.js", keep this; otherwise adjust (e.g., "node dist/index.js")
CMD ["node", "dist/bot.js"]
