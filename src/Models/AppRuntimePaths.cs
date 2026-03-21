using System.Text.Json;

namespace TelegramMonitor;

public static class AppRuntimePaths
{
    private const string DataDirectoryEnvName = "TGJK_DATA_DIR";
    private static readonly Lazy<string> DataDirectoryValue = new(ResolveDataDirectory);

    public static string BaseDirectory => AppContext.BaseDirectory;

    public static string DataDirectory => DataDirectoryValue.Value;

    public static string LogsDirectory => Path.Combine(DataDirectory, "logs");

    public static string SessionDirectory => Path.Combine(DataDirectory, "session");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(LogsDirectory);
        Directory.CreateDirectory(SessionDirectory);
    }

    public static string ResolveUnderDataDirectory(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return path;

        return Path.IsPathRooted(path)
            ? path
            : Path.Combine(DataDirectory, path);
    }

    private static string ResolveDataDirectory()
    {
        var envValue = Environment.GetEnvironmentVariable(DataDirectoryEnvName)?.Trim();
        if (!string.IsNullOrWhiteSpace(envValue))
            return NormalizePath(envValue);

        var configuredValue = TryReadConfiguredDataDirectory();
        if (!string.IsNullOrWhiteSpace(configuredValue))
            return NormalizePath(configuredValue);

        return Path.Combine(BaseDirectory, "data");
    }

    private static string TryReadConfiguredDataDirectory()
    {
        var appSettingsPath = Path.Combine(BaseDirectory, "appsettings.json");
        if (!File.Exists(appSettingsPath))
            return null;

        try
        {
            using var stream = File.OpenRead(appSettingsPath);
            using var document = JsonDocument.Parse(stream, new JsonDocumentOptions
            {
                CommentHandling = JsonCommentHandling.Skip,
                AllowTrailingCommas = true
            });

            if (document.RootElement.TryGetProperty("RuntimePaths", out var runtimePaths) &&
                runtimePaths.ValueKind == JsonValueKind.Object &&
                runtimePaths.TryGetProperty("DataDirectory", out var dataDirectoryProperty))
            {
                return dataDirectoryProperty.GetString();
            }
        }
        catch
        {
        }

        return null;
    }

    private static string NormalizePath(string path)
    {
        return Path.IsPathRooted(path)
            ? path
            : Path.Combine(BaseDirectory, path);
    }
}
