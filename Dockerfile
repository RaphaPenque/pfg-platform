FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (need dev deps for build)
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Create data directory for persistent storage
RUN mkdir -p /data

# Copy seed database as template
COPY pfg.db /app/pfg-seed.db

# Start script that copies seed DB if no existing DB, then starts server
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'if [ ! -f /data/pfg.db ]; then' >> /app/start.sh && \
    echo '  echo "No database found, seeding..."' >> /app/start.sh && \
    echo '  cp /app/pfg-seed.db /data/pfg.db' >> /app/start.sh && \
    echo 'fi' >> /app/start.sh && \
    echo 'ln -sf /data/pfg.db /app/pfg.db' >> /app/start.sh && \
    echo 'NODE_ENV=production node dist/index.cjs' >> /app/start.sh && \
    chmod +x /app/start.sh

EXPOSE 5000

CMD ["/app/start.sh"]
