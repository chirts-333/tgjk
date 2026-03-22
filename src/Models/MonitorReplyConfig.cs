namespace TelegramMonitor;

[SugarTable("MonitorReplyConfig")]
public class MonitorReplyConfig
{
    [SugarColumn(IsPrimaryKey = true)]
    public int Id { get; set; }

    // 是否启用“命中关键词后在原会话回复”。
    public bool EnableInChatReply { get; set; } = false;

    // 是否启用“模板随机回复”。
    public bool UseRandomReplyTemplate { get; set; } = false;

    // 未开启随机或模板列表为空时使用的默认模板。
    public string DefaultReplyTemplate { get; set; } = "收到，{sender}，你的消息命中了关键词：{keywords}";

    // JSON 数组字符串：["模板1","模板2"]。
    public string ReplyTemplatesJson { get; set; } = "[]";
}
