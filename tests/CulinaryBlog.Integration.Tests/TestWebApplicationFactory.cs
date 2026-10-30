using CulinaryBlog.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CulinaryBlog.Integration.Tests;

public sealed class TestWebApplicationFactory : WebApplicationFactory<Program>
{
    private readonly object _databaseLock = new();
    private PostgresTestDatabase? _database;

    internal string TestSchema => EnsureDatabase().Schema;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        var database = EnsureDatabase();
        builder.UseEnvironment("Development");

        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = database.ConnectionString,
                ["Database:ApplyMigrationsOnStartup"] = "false",
                ["Hangfire:Enabled"] = "false",
                ["Seq:ServerUrl"] = "",
            }));

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<ApplicationDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<ApplicationDbContext>>();
            services.AddDbContext<ApplicationDbContext>(options =>
                options.UseNpgsql(database.ConnectionString));
            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = "Test";
                options.DefaultChallengeScheme = "Test";
            })
            .AddScheme<AuthenticationSchemeOptions, TestAuthenticationHandler>(
                "Test",
                _ => { });
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && _database is not null)
        {
            _database.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        if (_database is not null)
        {
            await _database.DisposeAsync();
        }
    }

    private PostgresTestDatabase EnsureDatabase()
    {
        if (_database is not null)
        {
            return _database;
        }

        lock (_databaseLock)
        {
            _database ??= PostgresTestDatabase
                .CreateAsync(schemaPrefix: "web_factory")
                .GetAwaiter()
                .GetResult();
            return _database;
        }
    }
}
