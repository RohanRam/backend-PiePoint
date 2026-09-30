# Use the official Node.js Alpine lightweight image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies (faster and more secure)
RUN npm install --omit=dev

# Copy the rest of the application files
COPY . .

# Expose the port the app runs on (Render uses process.env.PORT which defaults to 3000 here)
EXPOSE 3000

# Command to run the server
CMD ["npm", "start"]
