# Dockerfile for Railway - Backend Service
# NOTE: This Dockerfile can't build frontend because it can't access ../frontend/
# Railway should use the ROOT Dockerfile instead (which can access frontend/)
# If Railway Root Directory is set to "backend", change it to empty/root

FROM node:18

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy all backend files
COPY . .

# Expose port (Railway will set PORT automatically)
EXPOSE 3000

# Start the server
CMD ["node", "server.js"]
