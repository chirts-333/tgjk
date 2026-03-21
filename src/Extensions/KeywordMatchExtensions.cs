namespace TelegramMonitor;

public static class KeywordMatchExtensions
{
    // 用户匹配：支持按用户 ID 或 @username 命中。
    public static List<KeywordConfig> MatchUser(
        long userId,
        IReadOnlyCollection<string> userNames,
        IEnumerable<KeywordConfig> allKeywords)
    {
        if (allKeywords == null) return new();
        return allKeywords
            .Where(k => k.KeywordType == KeywordType.User)
            .Where(k => IsUserMatch(userId, userNames, k.KeywordContent))
            .ToList();
    }

    // 正文匹配：排除 User 类型，仅匹配文本相关规则。
    public static List<KeywordConfig> MatchText(
        string message,
        IEnumerable<KeywordConfig> allKeywords)
    {
        if (string.IsNullOrWhiteSpace(message) || allKeywords == null) return new();
        return allKeywords
            .Where(k => k.KeywordType != KeywordType.User)
            .Where(k => IsKeywordMatch(k, message))
            .ToList();
    }

    private static bool IsUserMatch(long userId, IReadOnlyCollection<string> names, string keyword)
    {
        if (string.IsNullOrWhiteSpace(keyword))
            return false;

        // 支持用户输入带 @ 或不带 @ 的写法。
        var normalizedKeyword = keyword.StartsWith("@") ? keyword[1..] : keyword;

        if (userId.ToString() == normalizedKeyword)
            return true;

        return names.Any(name =>
        {
            var normalizedName = name.StartsWith("@") ? name[1..] : name;
            return string.Equals(normalizedName, normalizedKeyword, StringComparison.OrdinalIgnoreCase);
        });
    }

    private static bool IsKeywordMatch(KeywordConfig cfg, string message) =>
        !string.IsNullOrWhiteSpace(cfg.KeywordContent) && cfg.KeywordType switch
        {
            KeywordType.Contains => ContainsMatch(cfg.KeywordContent, message, cfg.IsCaseSensitive),
            KeywordType.Regex => RegexMatch(cfg.KeywordContent, message, cfg.IsCaseSensitive),
            KeywordType.Fuzzy => FuzzyMatch(cfg.KeywordContent, message, cfg.IsCaseSensitive),
            KeywordType.FullWord => FullWordMatch(cfg.KeywordContent, message, cfg.IsCaseSensitive),
            _ => false
        };

    private static bool ContainsMatch(string kw, string msg, bool cs) =>
        cs ? msg.Contains(kw) : msg.Contains(kw, StringComparison.OrdinalIgnoreCase);

    private static bool RegexMatch(string pattern, string msg, bool cs)
    {
        try
        {
            var opt = cs ? RegexOptions.None : RegexOptions.IgnoreCase;
            return Regex.IsMatch(msg, pattern, opt);
        }
        catch (ArgumentException) { return false; } // 正则非法时按“不匹配”处理。
    }

    private static bool FuzzyMatch(string kw, string msg, bool cs)
    {
        // 模糊匹配使用 ? 分隔多个片段，要求全部片段都出现。
        var parts = kw.Split('?', StringSplitOptions.RemoveEmptyEntries)
                      .Select(p => p.Trim())
                      .Where(p => p.Length > 0)
                      .ToArray();
        if (parts.Length == 0) return false;

        if (!cs) msg = msg.ToLowerInvariant();

        return parts.All(p =>
        {
            var target = cs ? p : p.ToLowerInvariant();
            return msg.Contains(target);
        });
    }

    private static bool FullWordMatch(string kw, string msg, bool cs) =>
        cs ? msg == kw : string.Equals(msg, kw, StringComparison.OrdinalIgnoreCase);
}
