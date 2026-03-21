namespace TelegramMonitor;

public static class SqlSugarSetup
{
    // 初始化 SqlSugar 并注册到依赖注入。
    public static void AddSqlSugarSetup(this IServiceCollection services)
    {
        var config = App.GetConfig<DbConnectionOptions>("DbConnection");
        config.ConnectionString = NormalizeConnectionString(config);

        if (!Enum.TryParse<DbType>(config.DbType, true, out var dbType))
        {
            throw new InvalidOperationException($"无效的数据库类型: {config.DbType}");
        }

        var sqlSugar = new SqlSugarScope(
            new ConnectionConfig
            {
                DbType = dbType,
                ConnectionString = config.ConnectionString,
                IsAutoCloseConnection = true
            },
            db => { }
        );

        services.AddSingleton<ISqlSugarClient>(sqlSugar);
        services.AddScoped<SqlSugarScope>(s => sqlSugar);

        InitializeDatabase(sqlSugar);
        services.AddSingleton<SystemCacheServices>();
    }

    private static string NormalizeConnectionString(DbConnectionOptions config)
    {
        if (config == null || string.IsNullOrWhiteSpace(config.ConnectionString))
            throw new InvalidOperationException("数据库连接字符串不能为空");

        if (!string.Equals(config.DbType, "Sqlite", StringComparison.OrdinalIgnoreCase))
            return config.ConnectionString;

        const string prefix = "DataSource=";
        const string altPrefix = "Data Source=";

        if (config.ConnectionString.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            var dbPath = config.ConnectionString[prefix.Length..].Trim();
            return $"{prefix}{AppRuntimePaths.ResolveUnderDataDirectory(dbPath)}";
        }

        if (config.ConnectionString.StartsWith(altPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var dbPath = config.ConnectionString[altPrefix.Length..].Trim();
            return $"{altPrefix}{AppRuntimePaths.ResolveUnderDataDirectory(dbPath)}";
        }

        return config.ConnectionString;
    }

    private static void InitializeDatabase(ISqlSugarClient db)
    {
        // 自动建库建表（首次启动）。
        db.DbMaintenance.CreateDatabase();

        InitializeTable<KeywordConfig>(db);
        InitializeTable<MonitorReplyConfig>(db);
        InitializeTable<GroupMessageTaskConfig>(db);
    }

    private static void InitializeTable<T>(ISqlSugarClient db) where T : class, new()
    {
        db.CodeFirst.InitTables<T>();
    }
}
