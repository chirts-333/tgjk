namespace TelegramMonitor;

public static class TelegramMonitorConstants
{
    // Telegram API 凭据。
    public const int ApiId = 23319500;
    public const string ApiHash = "814ac0dd67f660119b9b990d514c9a47";
    // 会话文件目录。
    public static string SessionPath => AppRuntimePaths.SessionDirectory;
}
