# ============================================================
# Stage 1: Builder stage
# ============================================================
FROM python:3.11-slim as builder

WORKDIR /build

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ============================================================
# Stage 2: Runtime stage
# ============================================================
FROM python:3.11-slim as runtime

WORKDIR /app

# Copy installed libraries and scripts from builder prefix
COPY --from=builder /install /usr/local

# Copy application source code
COPY . .

# Create a secure non-root user & group to run execution
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -d /app -s /bin/bash appuser && \
    chown -R appuser:appgroup /app

# Switch context to the non-root user
USER appuser

EXPOSE 8000

# Execute Gunicorn server supervising Uvicorn workers
CMD ["gunicorn", "main:app", "-w", "4", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000"]
