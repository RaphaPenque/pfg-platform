#!/bin/sh
set -e

echo "Type-checking client..."
./node_modules/.bin/tsc --noEmit --project tsconfig.client.json
echo "Type check passed."

echo "Building client..."
./node_modules/.bin/vite build

echo "Building server..."
./node_modules/.bin/esbuild server/index.ts \
  --platform=node \
  --bundle \
  --format=cjs \
  --outfile=dist/index.cjs \
  --define:process.env.NODE_ENV='"production"' \
  --minify \
  --log-level=info \
  --external:@azure/msal-node \
  --external:@microsoft/microsoft-graph-client \
  --external:@neondatabase/serverless \
  --external:better-sqlite3 \
  --external:connect-pg-simple \
  --external:drizzle-kit \
  --external:drizzle-orm \
  --external:esbuild \
  --external:passport \
  --external:passport-local \
  --external:pg \
  --external:vite \
  --external:@vitejs/plugin-react \
  --external:tsx \
  --external:typescript \
  --external:playwright \
  --external:playwright-core \
  --external:chromium-bidi \
  --external:@playwright/test

echo "Build complete."
