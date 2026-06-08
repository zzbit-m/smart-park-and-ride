import os
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
    OPERATOR_USERNAME: str = os.getenv("OPERATOR_USERNAME", "operator")
    OPERATOR_PASSWORD: str = os.getenv("OPERATOR_PASSWORD", "operator123")
    LIMIT_HOLD: int = int(os.getenv("LIMIT_HOLD", "5"))
    WINDOW_HOLD: int = int(os.getenv("WINDOW_HOLD", "60"))
    LIMIT_SCAN: int = int(os.getenv("LIMIT_SCAN", "60"))
    WINDOW_SCAN: int = int(os.getenv("WINDOW_SCAN", "60"))

    def validate(self) -> None:
        """Validate critical configuration settings on startup."""
        if not self.ADMIN_USERNAME or not self.ADMIN_PASSWORD:
            raise RuntimeError(
                "Admin credentials must be provided via environment variables (e.g. ADMIN_USER/ADMIN_USERNAME and ADMIN_PASSWORD)."
            )
        if self.ADMIN_PASSWORD == "password123":
            raise RuntimeError(
                "ADMIN_PASSWORD cannot be set to the default value 'password123'. "
                "Please configure a strong password in your .env file."
            )

# Singleton Settings object
settings = Settings()
settings.validate()
