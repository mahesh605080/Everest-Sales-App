FROM node:22-alpine
WORKDIR /app
ENV TZ=Asia/Kathmandu
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_MAP_STYLE_URL=""
ENV NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
# Applies new database changes, makes sure roles/settings/admin exist, then starts the site.
CMD ["sh", "-c", "npm run migrate && npm run seed && npm start"]
