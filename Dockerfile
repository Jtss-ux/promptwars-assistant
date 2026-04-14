FROM node:20-slim

# Create directory
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . ./

# Use a non-root user for security
USER node

EXPOSE 8080
ENV PORT=8080

CMD [ "node", "server.js" ]
