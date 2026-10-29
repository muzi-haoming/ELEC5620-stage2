FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend /app/backend
RUN useradd --uid 1000 --create-home app && mkdir -p /data/uploads && chown -R app:app /data
USER app
ENV UPLOAD_DIR=/data/uploads
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8001"]
