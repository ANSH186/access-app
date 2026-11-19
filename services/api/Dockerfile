# Production Dockerfile for AccessAble AI FastAPI Backend
# Base image: Official Python 3.11 lightweight slim image
FROM python:3.11-slim

# Labels for container metadata
LABEL maintainer="AccessAble AI Team" \
      description="Production container for AccessAble AI FastAPI service" \
      version="2.0.0"

# Set production environment variables
# - PYTHONDONTWRITEBYTECODE: Prevents Python from writing .pyc files to disk
# - PYTHONUNBUFFERED: Keeps stdout/stderr unbuffered for immediate logging
# - PYTHONPATH: Ensures imports from /app resolve correctly
# - PORT: Default port (overridden dynamically by Render or Docker Compose)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PORT=8000

# Set working directory inside container
WORKDIR /app

# Install system dependencies (curl for container health checks)
# and clean up apt cache to minimize image layer size
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root system user and group for security
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin -c "AccessAble App User" appuser

# Install Python dependencies first to leverage Docker layer caching
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy application source code and campus map resources
COPY services/api/app /app/app
COPY services/api/scripts /app/scripts
COPY data /app/data

# Set ownership of application files to non-root user
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose default API port (metadata documentation)
EXPOSE 8000

# Container healthcheck using FastAPI /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f "http://127.0.0.1:${PORT:-8000}/health" || exit 1

# Start Uvicorn with dynamic $PORT evaluation and graceful SIGTERM handling via exec
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
