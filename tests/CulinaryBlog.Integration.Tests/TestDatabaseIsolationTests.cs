using CulinaryBlog.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace CulinaryBlog.Integration.Tests;

public sealed class TestDatabaseIsolationTests
{
    [Fact]
    public void TestWebApplicationFactoryNeverTargetsThePublicApplicationSchema()
    {
        using var factory = new TestWebApplicationFactory();
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var connection = new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString());

        Assert.Equal(factory.TestSchema, connection.SearchPath);
        Assert.StartsWith("web_factory_", connection.SearchPath, StringComparison.Ordinal);
        Assert.NotEqual("public", connection.SearchPath);
    }
}
