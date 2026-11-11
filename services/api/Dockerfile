# Build from the repository root so the templates folder is included:
#   docker build -f services/api/Dockerfile -t accurova-photobooth-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/services/api

COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/api/app ./app
COPY templates /srv/templates

ENV PHOTOBOOTH_TEMPLATES_DIR=/srv/templates PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
