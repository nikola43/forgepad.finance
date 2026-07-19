# stable-diffusion.cpp for IMAGE_GEN_PROVIDER=local (CPU inference of the
# SD-Turbo GGUF mounted at /models). Separate stage so it caches independently
# of the Rust build. GGML_NATIVE targets this host's CPU (AVX-512 EPYC) — the
# container always runs where it was built.
FROM debian:trixie-slim AS sdcpp
RUN apt-get update && apt-get install -y git cmake g++ make ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --recursive https://github.com/leejet/stable-diffusion.cpp /sdcpp
RUN cmake -S /sdcpp -B /sdcpp/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON && \
    cmake --build /sdcpp/build -j2 --target sd-cli

FROM rust:latest AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y libpq-dev libssl-dev pkg-config

COPY Cargo.toml Cargo.lock ./
COPY src ./src

RUN cargo build --release

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y libpq5 libssl3 ca-certificates libgomp1 libstdc++6 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=sdcpp /sdcpp/build/bin/sd-cli /usr/local/bin/sd
COPY --from=builder /app/target/release/forgepad-backend /app/forgepad-backend
RUN mkdir -p /app/uploads

EXPOSE 5001
CMD ["./forgepad-backend"]
