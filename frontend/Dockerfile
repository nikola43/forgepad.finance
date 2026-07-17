FROM node:20-alpine AS builder

ARG NEXT_PUBLIC_PROJECT_ID
ARG NEXT_PUBLIC_LOCAL_MODE
ARG NEXT_PUBLIC_API_URL
# NEXT_PUBLIC_* are inlined at build time, so these must be declared here or the
# built image silently falls back to the in-code defaults.
ARG NEXT_PUBLIC_BSC_RPC_URL
ARG NEXT_PUBLIC_BSC_CHAIN_ID
ARG NEXT_PUBLIC_BSC_EXPLORER_URL
ENV NEXT_PUBLIC_PROJECT_ID=${NEXT_PUBLIC_PROJECT_ID:-ff3f4d54247f143a5f879f9a104d8662}
ENV NEXT_PUBLIC_LOCAL_MODE=${NEXT_PUBLIC_LOCAL_MODE:-true}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_BSC_RPC_URL=${NEXT_PUBLIC_BSC_RPC_URL}
ENV NEXT_PUBLIC_BSC_CHAIN_ID=${NEXT_PUBLIC_BSC_CHAIN_ID:-56}
ENV NEXT_PUBLIC_BSC_EXPLORER_URL=${NEXT_PUBLIC_BSC_EXPLORER_URL}
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ && npm install

COPY public ./public
COPY src ./src
COPY next.config.ts tsconfig.json next-env.d.ts ./

RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/out/ /usr/share/nginx/html/

COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
EOF

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
