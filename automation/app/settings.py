import os


class Settings:
    mongodb_uri: str = os.environ.get("MONGODB_URI", "mongodb://localhost:27018/croft")
    internal_token: str = os.environ.get("AUTOMATION_INTERNAL_TOKEN", "change-me-internal-token")
    port_range_start: int = int(os.environ.get("PORT_RANGE_START", "20000"))
    runtime_dir: str = os.environ.get("RUNTIME_DIR", "runtime")
    backend_url: str = os.environ.get("BACKEND_URL", "http://localhost:4000/api")
    bes_port: int = int(os.environ.get("BES_PORT", "9095"))
    # Set when automation runs in a container: "localhost" in a bytestream:// URI is the address
    # the user's Bazel (on the host) used, which from in here must be dialled via the host gateway.
    host_gateway: str = os.environ.get("CROFT_HOST_GATEWAY", "")

    # Resource limits for the sandboxed repo-analysis job (automation/app/repo_analysis.py). These
    # used to be hardcoded, which is exactly how the disk-space failure happened -- a fixed number
    # nobody had reason to reconsider until a real repo exceeded it. Tunable without a code change.
    analysis_cpu_limit: str = os.environ.get("ANALYSIS_CPU_LIMIT", "2")
    analysis_memory_limit: str = os.environ.get("ANALYSIS_MEMORY_LIMIT", "6g")
    analysis_pids_limit: str = os.environ.get("ANALYSIS_PIDS_LIMIT", "512")
    analysis_timeout_seconds: int = int(os.environ.get("ANALYSIS_TIMEOUT_SECONDS", "1200"))

    # Resource limits for the rebuild-simulation job (automation/app/rebuild_simulation.py). Higher
    # than the analysis tier by default: this job runs a real `bazel build` (actual compilation)
    # twice, not just `bazel query` (loading/analysis only, no actions executed).
    simulation_cpu_limit: str = os.environ.get("SIMULATION_CPU_LIMIT", "4")
    simulation_memory_limit: str = os.environ.get("SIMULATION_MEMORY_LIMIT", "8g")
    simulation_pids_limit: str = os.environ.get("SIMULATION_PIDS_LIMIT", "1024")
    simulation_timeout_seconds: int = int(os.environ.get("SIMULATION_TIMEOUT_SECONDS", "1800"))


settings = Settings()
