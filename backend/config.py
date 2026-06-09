import os
import warnings
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://parking_user:parking_pass@localhost:5432/parking_db",
    )
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    ADMIN_USERNAME: str | None = os.getenv("ADMIN_USERNAME") or os.getenv("ADMIN_USER")
    ADMIN_PASSWORD: str | None = os.getenv("ADMIN_PASSWORD")
    
    CORS_ALLOWED_ORIGINS: str = os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173,http://127.0.0.1:5173",
    )
    JWT_SECRET: str = os.getenv(
        "JWT_SECRET",
        "smart-park-and-ride-default-jwt-secret-v1",
    )
    TRUST_PROXY: bool = os.getenv("TRUST_PROXY", "False").lower() in ("true", "1", "yes")
    OPERATOR_USERNAME: str = os.getenv("OPERATOR_USERNAME", "operator")
    OPERATOR_PASSWORD: str = os.getenv("OPERATOR_PASSWORD", "operator123")
    LIMIT_HOLD: int = int(os.getenv("LIMIT_HOLD", "5"))
    WINDOW_HOLD: int = int(os.getenv("WINDOW_HOLD", "60"))
    LIMIT_SCAN: int = int(os.getenv("LIMIT_SCAN", "60"))
    WINDOW_SCAN: int = int(os.getenv("WINDOW_SCAN", "60"))

    # Monitoring and backup settings
    SENTRY_DSN: str | None = os.getenv("SENTRY_DSN")
    SENTRY_TRACES_SAMPLE_RATE: float = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0"))
    BACKUP_DIR: str = os.getenv("BACKUP_DIR", "./backups")
    BACKUP_RETENTION_DAYS: int = int(os.getenv("BACKUP_RETENTION_DAYS", "14"))
    BACKUP_S3_BUCKET: str | None = os.getenv("BACKUP_S3_BUCKET")
    BACKUP_S3_PREFIX: str = os.getenv("BACKUP_S3_PREFIX", "")

    def validate(self) -> None:
        """Validate critical configuration settings on startup."""
        if not self.ADMIN_USERNAME or not self.ADMIN_PASSWORD:
            raise RuntimeError(
                "Admin credentials must be provided via environment variables (e.g. ADMIN_USER/ADMIN_USERNAME and ADMIN_PASSWORD)."
            )
        
        is_production = os.getenv("ENV", "").lower() == "production"

        if is_production:
            if self.ADMIN_PASSWORD == "password123":
                raise RuntimeError(
                    "ADMIN_PASSWORD is set to the default value 'password123'. "
                    "This is insecure and prohibited in a production environment."
                )
            if self.OPERATOR_PASSWORD == "operator123":
                raise RuntimeError(
                    "OPERATOR_PASSWORD is set to the default value 'operator123'. "
                    "This is insecure and prohibited in a production environment."
                )
            if not self.JWT_SECRET or self.JWT_SECRET == "smart-park-and-ride-default-jwt-secret-v1":
                raise RuntimeError(
                    "JWT_SECRET is unset or set to the default development value. "
                    "A unique, secure JWT_SECRET must be provided in a production environment."
                )
        else:
            if self.ADMIN_PASSWORD == "password123":
                warnings.warn(
                    "ADMIN_PASSWORD is set to the default value 'password123'. "
                    "This is acceptable for local development but you should set a strong password in production."
                )
            if self.OPERATOR_PASSWORD == "operator123":
                warnings.warn(
                    "OPERATOR_PASSWORD is set to the default value 'operator123'. "
                    "This is acceptable for local development but you should set a strong password in production."
                )
            if self.JWT_SECRET == "smart-park-and-ride-default-jwt-secret-v1":
                warnings.warn(
                    "JWT_SECRET is set to the default development value. "
                    "This is acceptable for local development but you should set a strong secret in production."
                )

# Singleton Settings object
settings = Settings()
settings.validate()

