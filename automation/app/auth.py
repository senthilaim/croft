from fastapi import Header, HTTPException

from .settings import settings


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if x_internal_token != settings.internal_token:
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")
