FROM node:18-alpine

WORKDIR /app

# Build frontend first
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Setup backend
WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/ ./

# Copy bot directory to /bot (absolute path to ensure it's always available)
COPY bot/ /bot/

# Install bot dependencies
WORKDIR /bot
RUN npm install --omit=dev

# Return to app directory
WORKDIR /app

# Copy built frontend to backend public directory
RUN mkdir -p public && cp -r /frontend/dist/* public/

# Expose port
EXPOSE 8080

# Start server
CMD ["npm", "start"]

