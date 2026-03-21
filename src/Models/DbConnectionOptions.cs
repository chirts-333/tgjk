namespace TelegramMonitor;

public class DbConnectionOptions
{
    // 数据库连接字符串。
    public string ConnectionString { get; set; }
    // 数据库类型（需可被 SqlSugar 的 DbType 枚举解析）。
    public string DbType { get; set; }
}
