# Dockerfile for Railway
# Builds frontend, then copies backend files and starts the server

FROM node:18 AS frontend-builder

WORKDIR /frontend-build

# Build frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Backend stage
FROM node:18

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install backend dependencies
RUN npm ci --only=production

# Copy backend files
COPY backend/ ./

# Copy built frontend from builder stage
COPY --from=frontend-builder /frontend-build/dist ./dist

# Expose port (Railway will set PORT automatically)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]

