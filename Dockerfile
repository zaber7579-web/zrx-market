FROM node:18-alpine

WORKDIR /app

# Copy backend package files
COPY backend/package.json ./

# Install backend dependencies (use npm install, not npm ci)
RUN npm install --omit=dev

# Copy backend files
COPY backend/ ./

# Copy bot directory and install bot dependencies
COPY bot/package.json ../bot/
COPY bot/ ../bot/
WORKDIR /app/../bot
RUN npm install --omit=dev
WORKDIR /app

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]

