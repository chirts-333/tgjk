namespace TelegramMonitor;

[SugarTable("GroupMessageTaskConfig")]
public class GroupMessageTaskConfig
{
    [SugarColumn(IsPrimaryKey = true)]
    public int Id { get; set; }

    public int PerGroupIntervalSeconds { get; set; } = 30;

    public int MinIntervalSeconds { get; set; } = 300;

    public int MaxIntervalSeconds { get; set; } = 600;

    public string TemplatesJson { get; set; } = "[]";

    public string TargetChatIdsJson { get; set; } = "[]";
}
