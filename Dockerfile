FROM mcr.microsoft.com/dotnet/aspnet:9.0-bookworm-slim
WORKDIR /app

ENV TGJK_DATA_DIR=/data
ENV ASPNETCORE_URLS=http://+:5005

COPY out/linux-amd64/ /app/

VOLUME ["/data"]
EXPOSE 5005

ENTRYPOINT ["dotnet", "/app/tgjk.dll"]
