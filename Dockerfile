FROM mcr.microsoft.com/dotnet/runtime-deps:9.0-bookworm-slim
WORKDIR /app
ARG BIN_NAME=tgjk
ARG TARGETARCH
ENV TGJK_DATA_DIR=/data
COPY out/linux-${TARGETARCH}/ /app/
RUN chmod +x /app/${BIN_NAME}
VOLUME ["/data"]
EXPOSE 5005
ENTRYPOINT ["/app/tgjk"]
