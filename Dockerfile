FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs backend.mjs finance.mjs request-body.mjs ./
COPY public/ ./public/
USER node
ENV MONETA_BIND_ADDRESS=0.0.0.0
EXPOSE 4173
CMD ["node", "server.mjs"]
