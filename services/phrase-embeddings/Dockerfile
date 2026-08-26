FROM python:3.12-slim

LABEL org.opencontainers.image.title="BAR multilingual E5 similarity service" \
      org.opencontainers.image.description="Optional local multilingual phrase-similarity backend for BAR" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    PHRASE_EMBEDDINGS_HOST=0.0.0.0 \
    PHRASE_EMBEDDINGS_PORT=8093 \
    PHRASE_EMBEDDINGS_CACHE_DIR=/models

WORKDIR /app

COPY services/phrase-embeddings/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 bar \
    && mkdir -p /models \
    && chown -R bar:bar /models

COPY services/phrase-embeddings/server.py ./server.py
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/

USER bar
EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=5m --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8093/healthz', timeout=3)" || exit 1

CMD ["python", "server.py"]
