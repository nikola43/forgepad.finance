FROM ghcr.io/foundry-rs/foundry:latest AS builder

WORKDIR /app

COPY foundry.toml remappings.txt ./
COPY src ./src
COPY lib ./lib
COPY script ./script

RUN forge build

FROM ghcr.io/foundry-rs/foundry:latest

WORKDIR /app

COPY --from=builder /app/out ./out
COPY --from=builder /app/src ./src
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/script ./script
COPY --from=builder /app/foundry.toml ./foundry.toml
COPY --from=builder /app/remappings.txt ./remappings.txt

COPY deploy.sh ./deploy.sh
RUN chmod +x ./deploy.sh

CMD ["sh", "./deploy.sh"]
