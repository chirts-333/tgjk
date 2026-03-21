namespace TelegramMonitor;

public class SingleFilePublish : ISingleFilePublish
{
    // 不额外内嵌程序集。
    public Assembly[] IncludeAssemblies()
    {
        return Array.Empty<Assembly>();
    }

    // 指定需要参与单文件发布的程序集名称。
    public string[] IncludeAssemblyNames()
    {
        return new[]
        {
            "tgjk"
        };
    }
}
