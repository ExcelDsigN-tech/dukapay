# ── build ────────────────────────────────────────────────────────────────────
FROM rust:1.93-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release --locked || cargo build --release

# ── runtime ──────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 10001 indexer
COPY --from=build /app/target/release/dukapay-indexer /usr/local/bin/dukapay-indexer
USER indexer
EXPOSE 9464
ENTRYPOINT ["/usr/local/bin/dukapay-indexer"]
