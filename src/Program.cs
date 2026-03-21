using System.Text;

EnsureDefaultAppSettings();
TelegramMonitor.AppRuntimePaths.EnsureDirectories();
Serve.Run(RunOptions.Default.WithArgs(args));

static void EnsureDefaultAppSettings()
{
    var appSettingsPath = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
    if (File.Exists(appSettingsPath) && new FileInfo(appSettingsPath).Length > 0)
    {
        return;
    }

    const string defaultAppSettings = """
{
  "$schema": "https://gitee.com/dotnetchina/Furion/raw/v4/schemas/v4/furion-schema.json",
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore": "Information"
    }
  },
  "Urls": "http://*:5005",
  "AppSettings": {
    "InjectSpecificationDocument": false
  },
  "RuntimePaths": {
    "DataDirectory": "data"
  },
  "DbConnection": {
    "DbType": "Sqlite",
    "ConnectionString": "DataSource=telegrammonitor.db"
  },
  "AllowedHosts": "*"
}
""";

    File.WriteAllText(appSettingsPath, defaultAppSettings, new UTF8Encoding(false));
}
