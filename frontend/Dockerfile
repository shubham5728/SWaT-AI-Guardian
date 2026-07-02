# --- build stage: compile the Vite app ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Bake live-backend mode in; nginx serves these paths same-origin (see nginx.conf).
ENV VITE_TRANSPORT=ws
ENV VITE_WS_URL=/ws/stream
ENV VITE_API_BASE=/api
RUN npm run build

# --- serve stage: static files + reverse proxy to the backend ---
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
