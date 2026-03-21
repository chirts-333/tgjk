namespace TelegramMonitor;

public static class MessageFormatExtensions
{
    // Telegram MarkdownV2 保留字符集合，发送前需要转义。
    private static readonly char[] MdV2Reserved = new[] {
    '_','*','[',']','(',')','~','`','>','#','+','-','=','|','{','}','.','!'};

    private static string EscapeMdV2(string s)
    {
        if (string.IsNullOrEmpty(s)) return string.Empty;
        var sb = new StringBuilder(s.Length * 2);
        foreach (var ch in s)
        {
            if (Array.IndexOf(MdV2Reserved, ch) >= 0) sb.Append('\\');
            sb.Append(ch);
        }
        return sb.ToString();
    }

    // 把命中消息格式化为可直接转发的监控文本。
    public static string FormatForMonitor(this Message message,
        SendMessageEntity sendMessageEntity,
        IReadOnlyList<KeywordConfig> hitKeywords,
        bool includeSource = true)
    {
        // 样式来自命中关键词的合并结果（粗体、斜体、剧透等）。
        var mergedStyle = MergeKeywordStyles(hitKeywords);
        var styledText = ApplyStylesToText(message.message, mergedStyle);

        var keywordList = string.Join(", ",
            hitKeywords.Select(k => $"\\#{EscapeMdV2(k.KeywordContent)}"));

        var sb = new StringBuilder()
        .AppendLine($"内容：{styledText}")
        .AppendLine($"时间：`{message.Date.AddHours(8):yyyy-MM-dd HH:mm:ss}`");

        if (includeSource)
        {
            sb.AppendLine($"发送ID：`{sendMessageEntity.SendId}`")
              .AppendLine($"发送方：[{sendMessageEntity.SendTitle}](tg://user?id={sendMessageEntity.SendId})   {sendMessageEntity.SendUserNames.JoinUsernames()}")
              .AppendLine($"来源：`{sendMessageEntity.FromTitle}`    {sendMessageEntity.FromUserNames.JoinUsernames()}")
              .AppendLine($"链接：[【直达】](https://t.me/{sendMessageEntity.FromMainUserName ?? $"c/{sendMessageEntity.FromId}"}/{message.id})");
        }

        sb.AppendLine($"*命中关键词：* {keywordList}")
          .AppendLine("`--------------------------------`");
        return sb.ToString();
    }

    private static KeywordConfig MergeKeywordStyles(IEnumerable<KeywordConfig> list)
    {
        var merged = new KeywordConfig();
        // 只要任意规则开启该样式，则最终样式开启。
        foreach (var k in list)
        {
            merged.IsBold |= k.IsBold;
            merged.IsItalic |= k.IsItalic;
            merged.IsUnderline |= k.IsUnderline;
            merged.IsStrikeThrough |= k.IsStrikeThrough;
            merged.IsQuote |= k.IsQuote;
            merged.IsMonospace |= k.IsMonospace;
            merged.IsSpoiler |= k.IsSpoiler;
        }
        return merged;
    }

    private static string ApplyStylesToText(string text, KeywordConfig cfg)
    {
        var result = text ?? string.Empty;
        if (cfg.IsMonospace)
        {
            result = "`" + result.Replace("`", "\\`") + "`";
        }
        else
        {
            if (cfg.IsBold) result = $"*{result}*";

            // Telegram 特例：斜体+下划线需按指定顺序拼接。
            if (cfg.IsItalic && cfg.IsUnderline)
            {
                result = $"___{result}_**__";
            }
            else
            {
                if (cfg.IsItalic) result = $"_{result}_";
                if (cfg.IsUnderline) result = $"__{result}__";
            }

            if (cfg.IsStrikeThrough) result = $"~{result}~";
            if (cfg.IsSpoiler) result = $"||{result}||";
        }
        if (cfg.IsQuote)
            result = "\n>" + result.Replace("\n", "\n> ");

        return result;
    }

    private static readonly Regex _phoneRegex = new(@"^\+\d{6,15}$", RegexOptions.Compiled);

    // 手机号校验为 E.164 形式（+国家码+号码）。
    public static bool IsE164Phone(this string? phone)
        => !string.IsNullOrWhiteSpace(phone) && _phoneRegex.IsMatch(phone);
}
