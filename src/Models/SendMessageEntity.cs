namespace TelegramMonitor;

public class SendMessageEntity
{
    // 实际发送方信息。
    public long SendId { get; set; }
    public string SendTitle { get; set; }
    public IEnumerable<string> SendUserNames { get; set; }
    // 消息来源会话信息（群/频道/私聊）。
    public long FromId { get; set; }
    public string FromTitle { get; set; }
    public IEnumerable<string> FromUserNames { get; set; }
    public string FromMainUserName { get; set; }
}
