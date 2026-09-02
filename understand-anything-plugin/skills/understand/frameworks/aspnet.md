# ASP.NET Core Framework Addendum

> Injected into file-analyzer and architecture-analyzer prompts when ASP.NET Core is detected.
> Do NOT use as a standalone prompt — always append it to the base prompt template.

## ASP.NET Core MVC Structure

### Canonical File Roles

| File / Pattern | Role | Tags |
|---|---|---|
| `Program.cs`, `Startup.cs` | Application bootstrapping, middleware, and route configuration | `entry-point`, `config` |
| `Controllers/*Controller.cs` | MVC controllers whose public actions handle requests | `api-handler`, `controller` |
| `Areas/*/Controllers/*Controller.cs` | Area-scoped MVC controllers; the `[Area]` attribute is authoritative | `api-handler`, `controller` |
| `Views/**/*.cshtml` | Razor MVC views | `ui`, `razor-view` |
| `Areas/*/Views/**/*.cshtml` | Area-scoped Razor MVC views | `ui`, `razor-view` |
| `ViewModels/**/*.cs` | Types presented to Razor views | `data-model`, `view-model` |
| `Services/**/*.cs` | Application and domain services | `service` |
| `Repositories/**/*.cs`, `Data/**/*.cs` | Persistence contracts, implementations, and DbContext types | `data-model` |
| `Middleware/**/*.cs` | Request-pipeline middleware | `middleware` |
| `appsettings*.json` | Host and application configuration | `config` |

### Edge Patterns to Look For

- Controller actions that return a Razor view depend on that view. Respect Area and web-project boundaries; never connect same-named controllers or views across them.
- Razor `@model` and `@inject` directives create `depends_on` relationships only when the referenced project type resolves uniquely.
- Attribute route endpoints route to their uniquely identified controller action. Treat `[area]`, `[controller]`, and `[action]` as effective-value tokens.
- Literal Anchor Tag Helper values (`asp-area`, `asp-controller`, `asp-action`) route a Razor view to a uniquely resolved action. Skip dynamic values.
- Use deterministic C# dependency edges when available; do not infer a concrete implementation from naming alone.

### Architectural Layers

| Layer ID | Layer Name | What Goes Here |
|---|---|---|
| `layer:api` | API Layer | Controllers, actions, and HTTP endpoints |
| `layer:service` | Service Layer | Application and domain services |
| `layer:data` | Data Layer | Repositories, entities, DbContext, migrations |
| `layer:ui` | UI Layer | MVC Razor views, Areas, view models |
| `layer:middleware` | Middleware Layer | Request middleware, filters, authorization |
| `layer:config` | Configuration Layer | Program/Startup, appsettings, project configuration |

### Notable Patterns

- Areas are independent feature partitions. Prefer method `[Area]`, then class `[Area]`; do not infer routing Area from the directory alone.
- `[ActionName]` changes an action's effective public identity, while `[NonAction]` and `[NonController]` remove candidates.
- Standard view discovery checks controller-specific locations before shared locations, with Area locations preceding root `Views/Shared`.
- With Roslyn semantic facts, resolve `View()` and `View(object model)` to the action-named view, and use a view name only when the resolved `View(string...)` overload receives a string literal. Without facts, keep syntax-only discovery conservative and skip non-literal first arguments.
- Razor Pages (`Pages/`, `@page`, `PageModel`, `asp-page`), Blazor, Minimal APIs, View Components, and custom view-location expanders are outside the MVC convention rules.
- Dynamic route, controller, action, model, and view names are ambiguous evidence and must be skipped rather than guessed.
