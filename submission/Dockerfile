FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run compile && npm run build

FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=3001 CHAIN_ID=11155111
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
COPY deployments ./deployments
COPY app.py ./
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 3001
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-3001} --workers 2 --threads 4 --timeout 90 app:app"]
