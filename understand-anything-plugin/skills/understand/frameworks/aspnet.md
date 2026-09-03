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
- Razor partial tags and literal `Html.PartialAsync` / `Html.RenderPartialAsync` calls create file-to-file `view_partial` / `depends_on` relationships through the same Area-aware view resolver as action views.
- An explicit literal Razor `Layout` creates a file-to-file `view_layout` / `depends_on` relationship. A `_ViewStart.cshtml` records only its own layout edge; do not fan that edge out to every descendant view.
- Razor `@model` and `@inject` directives create `depends_on` relationships only when the referenced project type resolves uniquely.
- A Roslyn-confirmed `RedirectToAction` or `RedirectToActionPermanent` invocation creates an `action_redirect` / `routes` relationship when its literal action, controller, and Area resolve to exactly one action. Never infer redirects from syntax alone.
- Top-level `Program.cs` registrations create one edge from `Program.cs` to the uniquely resolved implementation file: global filters use `global_filter_registration` / `configures`, middleware uses `middleware_registration` / `middleware`, and DI uses `di_registration` / `configures`. Keep scope, service, implementation, and lifetime in evidence; never fan filters out to controllers or create service-to-implementation registration edges.
- Attribute route endpoints route to their uniquely identified controller action. Treat `[area]`, `[controller]`, and `[action]` as effective-value tokens.
- Literal Anchor Tag Helper values (`asp-area`, `asp-controller`, `asp-action`) route a Razor view to a uniquely resolved action. Skip dynamic values.
- Use deterministic C# dependency edges when available; do not infer a concrete implementation from naming alone.

### Symbol and File Edge Projection

Framework relations use a two-layer graph model. The provider always emits the precise symbol-level relation, such as an action function depending on a Razor view file. A relation may also set `fileProjection: true` to request a companion edge between the existing file nodes that own both endpoints. The projected edge keeps the relation's edge type and rule evidence. The generic materializer skips the companion when both endpoints belong to the same file or either file node is unavailable. A `{ edgeType }` projection may override the companion type when another framework needs that distinction.

ASP.NET requests file projection for cross-file `action_view`, `action_redirect`, `view_model`, `view_inject`, and `template_link` relations. It does not request projection for `view_partial`, `view_layout`, `global_filter_registration`, `middleware_registration`, or `di_registration`, because those relations already connect file nodes. `route_handler` also remains symbol-only because its endpoint and action belong to the same controller file.

`fileDependencies` remain unchanged and continue to feed `scan.importMap` for batching, Louvain community detection, and later `imports` recovery. File projection is the graph-edge counterpart: it preserves the framework relation's semantic edge type (`depends_on`, `routes`, `configures`, or `middleware`) and its rule evidence. An `imports` edge and a projected edge between the same files are distinct unless their edge types are identical.

### Provider Layering Boundary

The ASP.NET provider owns framework conventions only. Constructor injection from primary or normal constructors and instance fields, plus `implements` / `inherits` relationships, belong to the common deterministic C# layer. Do not reproduce those relationships in this provider. Prefer no edge when a view, action, or registration type is unresolved or ambiguous.

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
