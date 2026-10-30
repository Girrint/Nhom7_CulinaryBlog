using CulinaryBlog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace CulinaryBlog.Integration.Tests;

internal sealed class PostgresTestDatabase(
    string adminConnection,
    string schema,
    string connectionString) : IAsyncDisposable
{
    private int _disposed;

    public string ConnectionString { get; } = connectionString;
    public string Schema => schema;

    public ApplicationDbContext CreateContext() => new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseNpgsql(ConnectionString).Options);

    public static async Task<PostgresTestDatabase> CreateAsync(
        string baseline = "latest",
        string schemaPrefix = "integration")
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json")
            .AddJsonFile("appsettings.Development.json", optional: true)
            .AddEnvironmentVariables()
            .Build();
        var configuredConnection = configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:Postgres must be configured for PostgreSQL integration tests.");
        var adminConnection = new NpgsqlConnectionStringBuilder(configuredConnection)
        {
            Pooling = false,
        }.ConnectionString;
        var schema = $"{schemaPrefix}_{Guid.NewGuid():N}";

        await using (var connection = new NpgsqlConnection(adminConnection))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            // PostgreSQL extensions belong to the database, not the disposable test schema.
            // Serialize initial creation when fixtures start against a completely empty database.
            command.CommandText = $"""
                BEGIN;
                SELECT pg_advisory_xact_lock(3535001);
                CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
                CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
                CREATE SCHEMA "{schema}";
                COMMIT;
                """;
            await command.ExecuteNonQueryAsync();
        }

        var testConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            SearchPath = schema,
        }.ConnectionString;
        var database = new PostgresTestDatabase(adminConnection, schema, testConnection);
        try
        {
            await using var context = database.CreateContext();
            if (baseline == "latest")
            {
                await context.Database.MigrateAsync();
            }
            else
            {
                await context.GetService<IMigrator>().MigrateAsync(baseline);
            }

            return database;
        }
        catch
        {
            await database.DisposeAsync();
            throw;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // The schema is generated internally and never comes from configuration or user input.
        command.CommandText = $"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE";
        await command.ExecuteNonQueryAsync();
    }
}
