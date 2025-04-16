# Use Node.js LTS as base image (supports >=18.0.0 as specified in package.json)
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create a non-root user for improved security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Use non-root user for subsequent commands
USER nodejs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the port that the app will run on
EXPOSE 5000

# Health check to verify the app is running properly
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/api/health || exit 1

# Command to run the application
CMD ["node", "index.js"]