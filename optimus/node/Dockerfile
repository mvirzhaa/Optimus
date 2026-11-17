FROM node:22-slim
WORKDIR /app
COPY node/package*.json ./
RUN npm ci --omit=dev
COPY node/src ./src
COPY node/public ./public
COPY db/ /db/
ENV NODE_ENV=production DB_DIR=/db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
