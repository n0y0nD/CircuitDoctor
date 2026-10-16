FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 circuitdoctor \
    && useradd --uid 10001 --gid circuitdoctor --no-create-home circuitdoctor \
    && mkdir /app/secrets \
    && chown circuitdoctor:circuitdoctor /app/secrets \
    && chmod 700 /app/secrets
COPY circuitdoctor/ ./circuitdoctor/
COPY samples/*.net ./samples/
COPY --from=frontend /build/frontend/dist ./frontend/dist
USER circuitdoctor
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "circuitdoctor.api:app", "--host", "0.0.0.0", "--port", "8000"]
