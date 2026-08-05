FROM python:3.12-slim

# Install system deps (no apt cargo — we use rustup below)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgomp1 \
    git \
    curl \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain via rustup (apt cargo is too old for some packages)
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --no-modify-path --profile minimal

WORKDIR /app

# Opt out of deepeval/deepteam telemetry & update checks so the worker never
# phones home from inside a customer's network. The runner also sets these
# defensively at runtime; declaring them here covers any deepteam CLI usage too.
ENV DEEPEVAL_TELEMETRY_OPT_OUT=YES \
    DEEPEVAL_UPDATE_WARNING_OPT_OUT=YES \
    ERROR_REPORTING=NO

COPY requirements.txt .
# Bust Docker layer cache: 2026-03-11
RUN pip install --no-cache-dir -r requirements.txt

COPY runner.py .

ENTRYPOINT ["python", "-u", "runner.py"]
