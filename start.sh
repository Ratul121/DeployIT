#!/bin/bash

echo "🚀 Starting GitHub Deployment Platform"
echo "======================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v16 or higher."
    exit 1
fi

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is not running. Please start MongoDB first."
    echo "   Run: mongod"
    echo ""
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "⚠️  PM2 is not installed globally. Installing PM2..."
    npm install -g pm2
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Please configure your environment variables."
    echo "   Copy .env.example to .env and fill in your GitHub OAuth credentials."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start the application
echo "🌟 Starting the application..."
echo "   Access your app at: http://localhost:3000"
echo "   Press Ctrl+C to stop"
echo ""

npm run dev 