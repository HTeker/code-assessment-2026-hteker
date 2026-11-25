FROM node:24-alpine
WORKDIR /app
# tsx (which runs the TypeScript) is a dev dependency, so we install everything.
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3000
CMD ["npm", "start"]
