import os


class Settings:
    mongodb_uri: str = os.environ.get("MONGODB_URI", "mongodb://localhost:27018/croft")
    internal_token: str = os.environ.get("AUTOMATION_INTERNAL_TOKEN", "change-me-internal-token")
    port_range_start: int = int(os.environ.get("PORT_RANGE_START", "20000"))
    runtime_dir: str = os.environ.get("RUNTIME_DIR", "runtime")
    backend_url: str = os.environ.get("BACKEND_URL", "http://localhost:4000/api")
    bes_port: int = int(os.environ.get("BES_PORT", "9095"))


settings = Settings()
