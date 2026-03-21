namespace TelegramMonitor;

public static class TelegramEntityExtensions
{
    // 统一用户展示名：名+姓，自动去空白。
    public static string DisplayName(this User u)
        => $"{u.first_name}{u.last_name}".Trim();

    // 把用户名列表拼成 "@a @b @c" 的展示格式。
    public static string JoinUsernames(this IEnumerable<string>? names)
        => names?.Any() == true
            ? string.Join(' ', names.Select(n => $"@{n}"))
            : string.Empty;
}
