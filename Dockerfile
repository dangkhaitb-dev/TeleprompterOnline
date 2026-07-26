# Build: 11ty + Vite → static files
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: skip lefthook git-hook install (no .git in image)
RUN npm ci --ignore-scripts
COPY . .
# Canonical/og:url domain baked at build time (test vs production)
ARG SITE_URL=https://vteleprompter.com
ENV SITE_URL=$SITE_URL
RUN npm run build

# Serve: nginx static
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
