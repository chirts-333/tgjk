namespace TelegramMonitor;

public static class LoggingSetup
{
    // 注册日志、数据库、Telegram 相关基础服务。
    public static void AddLoggingSetup(this IServiceCollection services)
    {
        services.AddMonitorLogging(options =>
        {
            options.IgnorePropertyNames = new[] { "Byte" };
            options.IgnorePropertyTypes = new[] { typeof(byte[]) };
        });

        services.AddConsoleFormatter(options =>
        {
            options.DateFormat = "yyyy-MM-dd HH:mm:ss(zzz) dddd";
            options.ColorBehavior = LoggerColorBehavior.Enabled;
        });

        ConfigureFileLogging(services);
        services.AddSqlSugarSetup();
        services.AddTelegram();
    }

    private static void ConfigureFileLogging(IServiceCollection services)
    {
        // 按级别拆分日志文件，便于排障时快速定位。
        LogLevel[] logLevels = { LogLevel.Information, LogLevel.Warning, LogLevel.Error };

        foreach (var logLevel in logLevels)
        {
            services.AddFileLogging(options =>
            {
                options.WithTraceId = true;
                options.WithStackFrame = true;
                options.FileNameRule = _ =>
                {
                    string logsDir = AppRuntimePaths.LogsDirectory;
                    Directory.CreateDirectory(logsDir);
                    string fileName = $"{DateTime.Now:yyyy-MM-dd}_{logLevel}.log";
                    return Path.Combine(logsDir, fileName);
                };
                options.WriteFilter = logMsg => logMsg.LogLevel == logLevel;
                options.HandleWriteError = writeError =>
                {
                    writeError.UseRollbackFileName(Path.GetFileNameWithoutExtension(writeError.CurrentFileName) + "-oops" + Path.GetExtension(writeError.CurrentFileName));
                };
            });
        }
    }
}
