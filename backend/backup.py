"""Database backup utility for production readiness.

Use `pg_dump` to create a local PostgreSQL backup and optionally upload to S3.
Example cron entry:
    0 3 * * * /usr/bin/env python /app/backend/backup.py --upload-s3
"""

import argparse
import logging
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote_plus

from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

BACKUP_FILENAME_TEMPLATE = "smart-park-and-ride-backup-{timestamp}.dump"


def parse_postgres_url(url: str) -> dict:
    parsed = urlparse(url)
    if not parsed.scheme.startswith("postgresql"):
        raise ValueError("DATABASE_URL must use a PostgreSQL scheme")

    return {
        "user": unquote_plus(parsed.username) if parsed.username else None,
        "password": unquote_plus(parsed.password) if parsed.password else None,
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "dbname": parsed.path.lstrip("/"),
        "query": parse_qs(parsed.query),
    }


def build_pg_dump_command(connection_info: dict, output_path: Path) -> list[str]:
    user = connection_info["user"]
    host = connection_info["host"]
    port = connection_info["port"]
    dbname = connection_info["dbname"]
    query = connection_info["query"]

    pg_url = f"postgresql://"
    if user:
        pg_url += f"{user}@"
    pg_url += f"{host}:{port}/{dbname}"

    if query:
        query_pairs = []
        for key, values in query.items():
            for value in values:
                query_pairs.append(f"{key}={value}")
        pg_url += f"?{'&'.join(query_pairs)}"

    return [
        "pg_dump",
        "--format=custom",
        "--file",
        str(output_path),
        f"--dbname={pg_url}",
    ]


def upload_to_s3(backup_file: Path) -> None:
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError(
            "S3 upload is configured but boto3 is not installed. "
            "Install boto3 to enable S3 backup support."
        ) from exc

    bucket = settings.BACKUP_S3_BUCKET
    prefix = settings.BACKUP_S3_PREFIX.strip("/")
    key = f"{prefix}/{backup_file.name}" if prefix else backup_file.name

    s3 = boto3.client("s3")
    logger.info("Uploading backup %s to s3://%s/%s", backup_file.name, bucket, key)
    s3.upload_file(str(backup_file), bucket, key)
    logger.info("Backup upload complete")


def cleanup_old_backups(backup_dir: Path) -> None:
    if settings.BACKUP_RETENTION_DAYS <= 0:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.BACKUP_RETENTION_DAYS)
    for file_path in backup_dir.glob("*.dump"):
        if not file_path.is_file():
            continue
        modified_at = datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc)
        if modified_at < cutoff:
            logger.info("Removing expired backup file: %s", file_path.name)
            file_path.unlink(missing_ok=True)


def run_backup(upload_to_s3_enabled: bool = False) -> Path:
    connection_info = parse_postgres_url(settings.DATABASE_URL)
    backup_dir = Path(settings.BACKUP_DIR).expanduser().resolve()
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_file = backup_dir / BACKUP_FILENAME_TEMPLATE.format(timestamp=timestamp)

    cmd = build_pg_dump_command(connection_info, backup_file)
    env = os.environ.copy()
    if connection_info["password"]:
        env["PGPASSWORD"] = connection_info["password"]

    logger.info("Starting database backup to %s", backup_file)
    subprocess.run(cmd, check=True, env=env)
    logger.info("Backup completed successfully")

    cleanup_old_backups(backup_dir)

    if upload_to_s3_enabled and settings.BACKUP_S3_BUCKET:
        upload_to_s3(backup_file)

    return backup_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backup PostgreSQL via pg_dump")
    parser.add_argument(
        "--upload-s3",
        action="store_true",
        help="Upload the backup to S3 if BACKUP_S3_BUCKET is configured",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    try:
        backup_path = run_backup(upload_to_s3_enabled=args.upload_s3)
        logger.info("Database backup saved to %s", backup_path)
    except subprocess.CalledProcessError as exc:
        logger.error("pg_dump failed with return code %s", exc.returncode)
        raise
    except Exception:
        logger.exception("Backup failed")
        raise
