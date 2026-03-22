namespace TelegramMonitor;

[SugarTable("UserTelegramSettings")]
public class UserTelegramSettings
{
    [SugarColumn(IsPrimaryKey = true)]
    public int UserId { get; set; }

    [SugarColumn(IsNullable = false)]
    public long DefaultTargetChatId { get; set; }

    [SugarColumn(Length = 4000, IsNullable = false)]
    public string MonitorChatIdsJson { get; set; } = "[]";
}
