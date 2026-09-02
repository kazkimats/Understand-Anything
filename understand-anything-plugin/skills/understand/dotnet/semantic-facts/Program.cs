using System.Collections.Immutable;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Xml.Linq;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;

internal sealed record Input(string ProjectRoot, string[] ProjectFiles, string[] SourceFiles);

internal sealed record Output(
    int SchemaVersion,
    List<ProjectFacts> Projects,
    List<TypeFacts> Types,
    List<MethodFacts> Methods,
    List<InvocationFacts> Invocations,
    List<string> Diagnostics,
    List<string> Warnings);

internal sealed record ProjectFacts(
    string ProjectFile,
    bool CompilationSucceeded,
    string[] TargetFrameworks,
    string[] References,
    bool ReferencesResolved);

internal sealed record BaseTypeFacts(string SymbolName, string Kind, bool ResolvedOutsideProject);
internal sealed record AttributeFacts(string SymbolName, string[] Arguments);

internal sealed record TypeFacts(
    string ProjectFile,
    string SymbolName,
    string Kind,
    string FilePath,
    int[] LineRange,
    List<BaseTypeFacts> BaseTypes,
    List<AttributeFacts> Attributes);

internal sealed record MethodFacts(
    string ProjectFile,
    string ContainingType,
    string MethodName,
    string Kind,
    string FilePath,
    int[] LineRange,
    string[] Modifiers,
    bool IsConstructor,
    List<AttributeFacts> Attributes);

internal sealed record InvocationFacts(
    string ProjectFile,
    string ContainingType,
    string ContainingMethod,
    string InvocationName,
    string SymbolName,
    string FilePath,
    int[] LineRange,
    string[] Arguments,
    string TargetKind,
    bool Resolved);

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static async Task<int> Main()
    {
        var output = new Output(1, [], [], [], [], [], []);
        try
        {
            var input = await JsonSerializer.DeserializeAsync<Input>(Console.OpenStandardInput(), new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            if (input is null || string.IsNullOrWhiteSpace(input.ProjectRoot))
            {
                throw new InvalidOperationException("semantic-facts input is missing projectRoot");
            }

            MSBuildLocator.RegisterDefaults();
            var projectRoot = Path.GetFullPath(input.ProjectRoot);
            var selectedFiles = input.SourceFiles
                .Select(path => Path.GetFullPath(Path.Combine(projectRoot, path)))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var relativeProjectFile in input.ProjectFiles.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                await AnalyzeProject(projectRoot, relativeProjectFile, selectedFiles, output);
            }
        }
        catch (Exception error)
        {
            output.Warnings.Add($"Roslyn semantic analysis could not start: {error.Message}");
        }

        await JsonSerializer.SerializeAsync(Console.OpenStandardOutput(), output, JsonOptions);
        await Console.Out.WriteLineAsync();
        return 0;
    }

    private static async Task AnalyzeProject(
        string projectRoot,
        string relativeProjectFile,
        HashSet<string> selectedFiles,
        Output output)
    {
        var projectFile = NormalizeRelative(relativeProjectFile);
        var fullProjectFile = Path.GetFullPath(Path.Combine(projectRoot, projectFile));
        var workspaceWarnings = new List<string>();

        try
        {
            using var workspace = MSBuildWorkspace.Create();
            workspace.WorkspaceFailed += (_, args) => workspaceWarnings.Add(args.Diagnostic.Message);
            var project = await workspace.OpenProjectAsync(fullProjectFile);
            var compilation = await project.GetCompilationAsync();
            if (compilation is null)
            {
                throw new InvalidOperationException("Roslyn did not produce a compilation");
            }

            var errors = compilation.GetDiagnostics()
                .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)
                .ToArray();
            var referencesResolved = !errors.Any(IsReferenceDiagnostic)
                && !workspaceWarnings.Any(IsReferenceWarning);
            output.Projects.Add(new ProjectFacts(
                projectFile,
                errors.Length == 0,
                ReadTargetFrameworks(fullProjectFile),
                compilation.References
                    .Select(reference => reference.Display is null
                        ? null
                        : Path.GetFileNameWithoutExtension(reference.Display))
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Cast<string>()
                    .Distinct(StringComparer.Ordinal)
                    .Order(StringComparer.Ordinal)
                    .ToArray(),
                referencesResolved));

            output.Diagnostics.AddRange(errors.Select(error => $"{projectFile}: {error}"));
            output.Warnings.AddRange(workspaceWarnings.Select(warning => $"{projectFile}: {warning}"));

            foreach (var document in project.Documents)
            {
                if (document.FilePath is null || !selectedFiles.Contains(Path.GetFullPath(document.FilePath)))
                {
                    continue;
                }

                var root = await document.GetSyntaxRootAsync();
                var model = await document.GetSemanticModelAsync();
                if (root is null || model is null)
                {
                    continue;
                }

                var relativeFile = Path.GetRelativePath(projectRoot, document.FilePath).Replace('\\', '/');
                CollectTypes(projectFile, relativeFile, root, model, compilation.Assembly, output);
                CollectMethods(projectFile, relativeFile, root, model, output);
                CollectInvocations(projectFile, relativeFile, root, model, output);
            }
        }
        catch (Exception error)
        {
            output.Projects.Add(new ProjectFacts(
                projectFile,
                false,
                File.Exists(fullProjectFile) ? ReadTargetFrameworks(fullProjectFile) : [],
                [],
                false));
            output.Diagnostics.Add($"{projectFile}: {error.Message}");
            output.Warnings.AddRange(workspaceWarnings.Select(warning => $"{projectFile}: {warning}"));
        }
    }

    private static void CollectTypes(
        string projectFile,
        string filePath,
        SyntaxNode root,
        SemanticModel model,
        IAssemblySymbol projectAssembly,
        Output output)
    {
        foreach (var declaration in root.DescendantNodes().OfType<BaseTypeDeclarationSyntax>())
        {
            if (model.GetDeclaredSymbol(declaration) is not INamedTypeSymbol symbol)
            {
                continue;
            }

            var baseTypes = new List<BaseTypeFacts>();
            for (var current = symbol.BaseType; current is not null; current = current.BaseType)
            {
                baseTypes.Add(new BaseTypeFacts(
                    SymbolName(current),
                    current.TypeKind.ToString().ToLowerInvariant(),
                    !SymbolEqualityComparer.Default.Equals(current.ContainingAssembly, projectAssembly)));
            }

            foreach (var @interface in symbol.AllInterfaces)
            {
                baseTypes.Add(new BaseTypeFacts(
                    SymbolName(@interface),
                    "interface",
                    !SymbolEqualityComparer.Default.Equals(@interface.ContainingAssembly, projectAssembly)));
            }

            output.Types.Add(new TypeFacts(
                projectFile,
                SymbolName(symbol),
                symbol.TypeKind.ToString().ToLowerInvariant(),
                filePath,
                LineRange(declaration),
                baseTypes,
                Attributes(symbol.GetAttributes())));
        }
    }

    private static void CollectMethods(
        string projectFile,
        string filePath,
        SyntaxNode root,
        SemanticModel model,
        Output output)
    {
        var declarations = root.DescendantNodes()
            .Where(node => node is MethodDeclarationSyntax or ConstructorDeclarationSyntax);
        foreach (var declaration in declarations)
        {
            if (model.GetDeclaredSymbol(declaration) is not IMethodSymbol symbol)
            {
                continue;
            }

            var modifiers = new List<string> { symbol.DeclaredAccessibility.ToString().ToLowerInvariant() };
            modifiers.Add(symbol.IsStatic ? "static" : "instance");
            output.Methods.Add(new MethodFacts(
                projectFile,
                SymbolName(symbol.ContainingType),
                symbol.Name,
                "method",
                filePath,
                LineRange(declaration),
                modifiers.ToArray(),
                symbol.MethodKind is MethodKind.Constructor or MethodKind.StaticConstructor,
                Attributes(symbol.GetAttributes())));
        }
    }

    private static void CollectInvocations(
        string projectFile,
        string filePath,
        SyntaxNode root,
        SemanticModel model,
        Output output)
    {
        foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var containing = model.GetEnclosingSymbol(invocation.SpanStart) as IMethodSymbol;
            if (containing?.ContainingType is null)
            {
                continue;
            }

            var info = model.GetSymbolInfo(invocation);
            var symbol = info.Symbol as IMethodSymbol;
            var resolved = symbol is not null;
            var name = invocation.Expression switch
            {
                MemberAccessExpressionSyntax member => member.Name.Identifier.ValueText,
                IdentifierNameSyntax identifier => identifier.Identifier.ValueText,
                GenericNameSyntax generic => generic.Identifier.ValueText,
                _ => invocation.Expression.ToString(),
            };
            output.Invocations.Add(new InvocationFacts(
                projectFile,
                SymbolName(containing.ContainingType),
                containing.Name,
                name,
                symbol is null ? "" : MethodSymbolName(symbol),
                filePath,
                LineRange(invocation),
                invocation.ArgumentList.Arguments.Select(argument => argument.Expression.ToString()).ToArray(),
                TargetKind(symbol),
                resolved));
        }
    }

    private static List<AttributeFacts> Attributes(ImmutableArray<AttributeData> attributes) =>
        attributes.Select(attribute => new AttributeFacts(
            attribute.AttributeClass is null ? "" : SymbolName(attribute.AttributeClass),
            attribute.ConstructorArguments.Select(AttributeArgument).ToArray())).ToList();

    private static string AttributeArgument(TypedConstant argument)
    {
        if (argument.Kind == TypedConstantKind.Array)
        {
            return string.Join(",", argument.Values.Select(AttributeArgument));
        }
        return argument.Value?.ToString() ?? "null";
    }

    private static string TargetKind(IMethodSymbol? symbol)
    {
        if (symbol is null) return "unresolvable";
        if (symbol.ReducedFrom is not null || symbol.IsExtensionMethod) return "extension";
        return symbol.IsStatic ? "static" : "instance-method";
    }

    private static string MethodSymbolName(IMethodSymbol symbol)
    {
        var original = symbol.ReducedFrom ?? symbol;
        var parameters = string.Join(",", original.Parameters.Select(parameter => SymbolName(parameter.Type)));
        return $"{SymbolName(original.ContainingType)}.{original.Name}({parameters})";
    }

    private static string SymbolName(ITypeSymbol symbol) =>
        symbol.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat)
            .Replace("global::", string.Empty, StringComparison.Ordinal);

    private static int[] LineRange(SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return [span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1];
    }

    private static string[] ReadTargetFrameworks(string projectFile)
    {
        try
        {
            var document = XDocument.Load(projectFile);
            return document.Descendants()
                .Where(element => element.Name.LocalName is "TargetFramework" or "TargetFrameworks")
                .SelectMany(element => element.Value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static bool IsReferenceDiagnostic(Diagnostic diagnostic) =>
        diagnostic.Id is "CS0006" or "CS0012" or "CS0234" or "CS0246";

    private static bool IsReferenceWarning(string warning) =>
        warning.Contains("reference", StringComparison.OrdinalIgnoreCase)
        || warning.Contains("resolve", StringComparison.OrdinalIgnoreCase)
        || warning.Contains("restore", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeRelative(string path) => path.Replace('\\', '/').TrimStart('.', '/');
}
