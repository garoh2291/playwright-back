# Use the Playwright base image (always fetches the latest compatible version)
FROM mcr.microsoft.com/playwright:latest

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
RUN npm run build

# Expose the application port
EXPOSE 3002

# Start the application
CMD ["npm", "start"]