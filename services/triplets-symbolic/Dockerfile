FROM python:3.12-slim

LABEL org.opencontainers.image.title="BAR spaCy relations service" \
      org.opencontainers.image.description="Optional local RU/EN semantic-relations backend for BAR" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    TRIPLET_SPACY_HOST=0.0.0.0 \
    TRIPLET_SPACY_PORT=8092

WORKDIR /app

COPY services/triplets-symbolic/requirements-spacy.txt ./requirements-spacy.txt
RUN python -m pip install --no-cache-dir -r requirements-spacy.txt \
    && useradd --create-home --uid 10001 bar

COPY services/triplets-symbolic/bar_triplets_symbolic ./bar_triplets_symbolic
COPY services/triplets-symbolic/server.py ./server.py
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md /licenses/

USER bar
EXPOSE 8092

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8092/healthz', timeout=3)" || exit 1

CMD ["python", "server.py"]
