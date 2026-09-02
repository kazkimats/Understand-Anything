import { describe, expect, it } from "vitest";
import { aspnetConfig } from "../../languages/frameworks/aspnet.js";
import type { FrameworkRelationContext } from "../types.js";
import { aspnetProvider } from "./aspnet.js";

function context(files: Record<string, string>): FrameworkRelationContext {
  return {
    projectRoot: "/fixture",
    framework: aspnetConfig,
    files: Object.entries(files).map(([path, content]) => ({
      path,
      language: path.endsWith(".cs") ? "csharp"
        : path.endsWith(".cshtml") ? "razor" : "csproj",
      sizeLines: content.split("\n").length,
      fileCategory: path.endsWith(".cshtml") ? "markup"
        : path.endsWith(".cs") ? "code" : "config",
    })),
    async readFile(path) {
      return files[path] ?? null;
    },
  };
}

const webProject = '<Project Sdk="Microsoft.NET.Sdk.Web" />\n';

describe("aspnetProvider MVC conventions", () => {
  it("isolates Areas and web projects while resolving action views", async () => {
    const files = {
      "src/Web/Web.csproj": webProject,
      "src/Web/Areas/Admin/Controllers/HomeController.cs": `
namespace Web.Areas.Admin;
[Area("Admin")]
public class HomeController : Controller {
  public IActionResult Index() { return View(); }
}`,
      "src/Web/Areas/Admin/Views/Home/Index.cshtml": "<h1>Admin</h1>\n",
      "src/Web/Areas/Customer/Controllers/HomeController.cs": `
namespace Web.Areas.Customer;
[Area("Customer")]
public class HomeController : Controller {
  public IActionResult Index() { return View(); }
}`,
      "src/Web/Areas/Customer/Views/Home/Index.cshtml": "<h1>Customer</h1>\n",
      "src/Other/Other.csproj": webProject,
      "src/Other/Controllers/HomeController.cs": `
namespace Other;
public class HomeController : Controller {
  public IActionResult Index() { return View(); }
}`,
      "src/Other/Views/Home/Index.cshtml": "<h1>Other</h1>\n",
      "src/Library/Library.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    };

    const result = await aspnetProvider.analyze(context(files));
    const dependencies = result.fileDependencies
      .filter((dependency) => dependency.kind === "action_view")
      .map((dependency) => [dependency.sourcePath, dependency.targetPath]);

    expect(dependencies).toEqual(expect.arrayContaining([
      [
        "src/Web/Areas/Admin/Controllers/HomeController.cs",
        "src/Web/Areas/Admin/Views/Home/Index.cshtml",
      ],
      [
        "src/Web/Areas/Customer/Controllers/HomeController.cs",
        "src/Web/Areas/Customer/Views/Home/Index.cshtml",
      ],
      ["src/Other/Controllers/HomeController.cs", "src/Other/Views/Home/Index.cshtml"],
    ]));
    expect(dependencies).toHaveLength(3);
    expect(result.stats.webProjectsDetected).toBe(2);
    expect(result.stats.actionViewsResolved).toBe(3);
    expect(result.stats.areaControllers).toBe(2);
  });

  it("supports ActionName, action-level Area, shared, explicit, and relative views", async () => {
    const files = {
      "Web/Web.csproj": webProject,
      "Web/Controllers/UsersController.cs": `
public class UsersController : Controller {
  [ActionName("List")]
  public IActionResult Index() { return View(); }
  public IActionResult Shared() { return View("Notice"); }
  public IActionResult Explicit() { return View("~/Views/Home/Foo.cshtml"); }
  public IActionResult Relative() { return View("../Manage/Index"); }
  public IActionResult Dynamic() { return View(viewName); }
  [Area("Admin")]
  public IActionResult AreaOnly() { return View("Detail"); }
  [NonAction]
  public IActionResult Hidden() { return View(); }
  public static IActionResult StaticAction() { return View(); }
}
`,
      "Web/Views/Users/List.cshtml": "List\n",
      "Web/Views/Shared/Notice.cshtml": "Notice\n",
      "Web/Views/Home/Foo.cshtml": "Foo\n",
      "Web/Views/Manage/Index.cshtml": "Manage\n",
      "Web/Areas/Admin/Views/Users/Detail.cshtml": "Detail\n",
    };

    const result = await aspnetProvider.analyze(context(files));
    const targets = result.fileDependencies
      .filter((dependency) => dependency.kind === "action_view")
      .map((dependency) => dependency.targetPath);

    expect(targets).toEqual(expect.arrayContaining([
      "Web/Views/Users/List.cshtml",
      "Web/Views/Shared/Notice.cshtml",
      "Web/Views/Home/Foo.cshtml",
      "Web/Views/Manage/Index.cshtml",
      "Web/Areas/Admin/Views/Users/Detail.cshtml",
    ]));
    expect(targets).toHaveLength(5);
    expect(result.stats.actionsScanned).toBe(6);
  });

  it("honors controller attributes, reports Area mismatch, and observes custom view locations", async () => {
    const files = {
      "Web/Web.csproj": webProject,
      "Web/Areas/Wrong/Controllers/Reports.cs": `
[Controller]
[Area("Admin")]
public class Reports : Controller {
  public IActionResult Index() { return View(); }
}
[NonController]
public class HiddenController : Controller {
  public IActionResult Index() { return View(); }
}`,
      "Web/Config/ViewConfig.cs": `public class ViewConfig {
  public void Configure() { options.ViewLocationFormats.Add("/Features/{1}/{0}.cshtml"); }
}`,
    };

    const result = await aspnetProvider.analyze(context(files));

    expect(result.stats.controllersScanned).toBe(1);
    expect(result.stats.actionsScanned).toBe(1);
    expect(result.stats.areaPathMismatch).toBe(1);
    expect(result.stats.customViewLocationSkipped).toBe(1);
    expect(result.warnings[0]).toContain('conflicts with Areas/Wrong/ path');
  });
});

describe("aspnetProvider Razor and routing conventions", () => {
  it("resolves Razor model/inject types and skips ambiguous or cross-project types", async () => {
    const files = {
      "Web/Web.csproj": webProject,
      "Web/ViewModels/UserViewModel.cs": `namespace App.ViewModels;
public class UserViewModel { }
public class PagedResult<T> { }`,
      "Web/Services/IUserService.cs": "namespace App.Services; public interface IUserService { }",
      "Web/Other/UserViewModel.cs": "namespace App.Other; public class UserViewModel { }",
      "Web/Views/_ViewImports.cshtml": "@using App.ViewModels\n@using App.Services\n",
      "Web/Views/Home/Index.cshtml": `@model App.ViewModels.UserViewModel?
@inject IUserService Service
<h1>Index</h1>`,
      "Web/Views/Home/List.cshtml": "@model PagedResult<UserViewModel>\n",
      "Web/Views/Home/Ambiguous.cshtml": "@model MissingType\n",
      "Web/Standalone/Ambiguous.cshtml": "@model UserViewModel\n",
      "Web/Pages/Index.cshtml": "@page\n@model UserViewModel\n",
      "Other/Other.csproj": webProject,
      "Other/Models/OnlyElsewhere.cs": "public class OnlyElsewhere { }",
      "Web/Views/Home/Cross.cshtml": "@model OnlyElsewhere\n",
    };

    const result = await aspnetProvider.analyze(context(files));
    const dependencies = result.fileDependencies.filter((dependency) =>
      dependency.kind === "view_model" || dependency.kind === "view_inject");

    expect(dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourcePath: "Web/Views/Home/Index.cshtml",
        targetPath: "Web/ViewModels/UserViewModel.cs",
        kind: "view_model",
      }),
      expect.objectContaining({
        sourcePath: "Web/Views/Home/Index.cshtml",
        targetPath: "Web/Services/IUserService.cs",
        kind: "view_inject",
      }),
      expect.objectContaining({
        sourcePath: "Web/Views/Home/List.cshtml",
        targetPath: "Web/ViewModels/UserViewModel.cs",
        kind: "view_model",
      }),
    ]));
    expect(result.stats.razorInjectsResolved).toBe(1);
    expect(result.stats.razorModelsAmbiguous).toBe(1);
    expect(result.stats.razorViewsScanned).toBe(5);
    expect(result.stats.crossProjectSkipped).toBe(1);
  });

  it("creates attribute endpoints and literal Tag Helper routes without conventional fan-out", async () => {
    const files = {
      "Web/Web.csproj": webProject,
      "Web/Areas/Admin/Controllers/UsersController.cs": `
[Area("Admin")]
[Route("[area]/[controller]")]
public class UsersController : Controller {
  [HttpGet("{id}")]
  [ActionName("List")]
  public IActionResult Index(int id) { return View("Detail"); }
}`,
      "Web/Areas/Admin/Views/Users/Detail.cshtml": `<a asp-controller="Users" asp-action="List">Ambient</a>
<a asp-area="" asp-controller="Home" asp-action="Index">Root</a>
<a asp-area="@Model.Area" asp-controller="Users" asp-action="List">Dynamic</a>`,
      "Web/Controllers/HomeController.cs": `public class HomeController : Controller {
  [HttpGet("home")]
  public IActionResult Index() { return View(); }
  [Route("[controller]/[action]")]
  [HttpPost]
  public IActionResult Save() { return View("Index"); }
}`,
      "Web/Views/Home/Index.cshtml": "Home\n",
      "Web/Program.cs": `app.MapControllerRoute(
  name: "default",
  pattern: "{controller=Home}/{action=Index}/{id?}");
app.MapAreaControllerRoute(name: "areas", areaName: "Admin", pattern: "{area:exists}/{controller}/{action}");`,
    };

    const result = await aspnetProvider.analyze(context(files));
    const endpoints = result.nodes.filter((candidate) => candidate.node.type === "endpoint");
    const routeRelations = result.relations.filter((relation) => relation.edgeType === "routes");

    expect(endpoints.map((candidate) => candidate.node.name)).toEqual(expect.arrayContaining([
      "GET /Admin/Users/{id}",
      "GET /home",
      "POST /Home/Save",
    ]));
    expect(result.stats.attributeRoutesResolved).toBe(3);
    expect(result.stats.conventionalRoutesObserved).toBe(2);
    expect(result.stats.tagHelperLinksResolved).toBe(2);
    expect(routeRelations).toHaveLength(5);
  });
});
