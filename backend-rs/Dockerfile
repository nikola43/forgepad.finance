FROM rust:latest AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y libpq-dev libssl-dev pkg-config

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y libpq5 libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/forgepad-backend /app/forgepad-backend
RUN mkdir -p /app/uploads

EXPOSE 5001
CMD ["./forgepad-backend"]
