# langchain_agent/tests/conftest.py
"""Shared pytest hooks and constants for stable test runs."""

import base64
import os


def pytest_configure(config):
    """Force valid Fernet salt during tests (avoids bad ENCRYPTION_SALT from host env)."""
    os.environ["ENCRYPTION_SALT"] = base64.urlsafe_b64encode(b"sixteenbytesalt!").decode()
    os.environ.setdefault("ENCRYPTION_MASTER_KEY", "test-master-key-32-characters!!")


# Matches SecurityConfig in src/config/settings.py
TEST_SECURITY_KWARGS = {
    "encryption_master_key": "test-key-32-chars-long-for-aes-ok!!",
    "encryption_salt": base64.urlsafe_b64encode(b"sixteenbytesalt!").decode(),
    "token_expiry_buffer_seconds": 300,
    "session_timeout_minutes": 60,
    "max_retry_attempts": 3,
    "retry_backoff_seconds": 1,
}
