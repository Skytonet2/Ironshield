FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Build Next.js frontend (static export)
RUN npm run build

EXPOSE 3001 8443

# Default: run all IronClaw services (backend + bot + governance + autonomous loop + jobs)
CMD ["npm", "run", "ironclaw"]
