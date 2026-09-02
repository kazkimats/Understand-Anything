import { posix } from "node:path";
import { TreeSitterPlugin } from "../../plugins/tree-sitter-plugin.js";
import { csharpConfig } from "../../languages/configs/csharp.js";
import type {
  AttributeInfo,
  CallGraphEntry,
  StructuralAnalysis,
} from "../../types.js";
import type {
  FrameworkFileDependency,
  FrameworkNodeCandidate,
  FrameworkRelation,
  FrameworkRelationContext,
  FrameworkRelationProvider,
  FrameworkRelationResult,
} from "../types.js";

type ClassInfo = StructuralAnalysis["classes"][number];
type FunctionInfo = StructuralAnalysis["functions"][number];

interface ParsedCSharpFile {
  path: string;
  structure: StructuralAnalysis;
  calls: CallGraphEntry[];
  content: string;
}

interface WebProject {
  projectFile: string;
  root: string;
  files: Set<string>;
}

interface ControllerInfo {
  project: WebProject;
  file: ParsedCSharpFile;
  declaration: ClassInfo;
  controllerName: string;
  classArea: string | null;
}

interface ActionInfo {
  controller: ControllerInfo;
  method: FunctionInfo;
  actionName: string;
  area: string | null;
  key: string;
  nodeId: string;
}

interface TypeInfo {
  project: WebProject;
  path: string;
  declaration: ClassInfo;
}

const ASPNET_KEYWORDS = [
  "microsoft.net.sdk.web",
  "microsoft.aspnetcore.app",
  "microsoft.aspnetcore.mvc",
  "microsoft.net.sdk.razor",
];

const HTTP_ATTRIBUTES: Record<string, string> = {
  httpget: "GET",
  httppost: "POST",
  httpput: "PUT",
  httpdelete: "DELETE",
  httppatch: "PATCH",
  httphead: "HEAD",
  httpoptions: "OPTIONS",
};

const EMPTY_STATS = {
  webProjectsDetected: 0,
  controllersScanned: 0,
  actionsScanned: 0,
  areaControllers: 0,
  areaActions: 0,
  areaPathMismatch: 0,
  actionViewCandidates: 0,
  actionViewsResolved: 0,
  actionViewsMissing: 0,
  actionViewsAmbiguous: 0,
  razorViewsScanned: 0,
  razorModelsResolved: 0,
  razorModelsAmbiguous: 0,
  razorInjectsResolved: 0,
  attributeRoutesResolved: 0,
  conventionalRoutesObserved: 0,
  tagHelperLinksResolved: 0,
  tagHelperLinksAmbiguous: 0,
  crossProjectSkipped: 0,
  customViewLocationSkipped: 0,
};

function normalizePath(path: string): string {
  return posix.normalize(path.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function dirname(path: string): string {
  const result = posix.dirname(path);
  return result === "." ? "" : result;
}

function isInRoot(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}

function relativeToRoot(path: string, root: string): string {
  return root === "" ? path : path.slice(root.length + 1);
}

function inProject(root: string, relativePath: string): string | null {
  const normalized = normalizePath(relativePath);
  if (normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    return null;
  }
  return root ? `${root}/${normalized}` : normalized;
}

function normalizedAttributeName(attribute: AttributeInfo): string {
  const shortName = attribute.name.split(".").pop() ?? attribute.name;
  return shortName.replace(/Attribute$/i, "").toLowerCase();
}

function attributes(value: { attributes?: AttributeInfo[] }): AttributeInfo[] {
  return value.attributes ?? [];
}

function hasAttribute(value: { attributes?: AttributeInfo[] }, name: string): boolean {
  const expected = name.toLowerCase();
  return attributes(value).some((attribute) => normalizedAttributeName(attribute) === expected);
}

function findAttributes(value: { attributes?: AttributeInfo[] }, name: string): AttributeInfo[] {
  const expected = name.toLowerCase();
  return attributes(value).filter((attribute) => normalizedAttributeName(attribute) === expected);
}

function stringLiteral(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('@"') && trimmed.endsWith('"')) {
    return trimmed.slice(2, -1).replace(/""/g, '"');
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return null;
}

function firstAttributeString(value: { attributes?: AttributeInfo[] }, name: string): string | null {
  for (const attribute of findAttributes(value, name)) {
    const literal = stringLiteral(attribute.arguments[0]);
    if (literal !== null) return literal;
  }
  return null;
}

function actionKey(root: string, area: string | null, controller: string, action: string): string {
  return [root || ".", area ?? "", controller, action].join("|").toLowerCase();
}

function actionNodeKey(action: ActionInfo): string {
  return `aspnet:action:${action.key}`;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function pathArea(path: string, root: string, kind: "Controllers" | "Views"): string | null {
  const relative = relativeToRoot(path, root);
  const match = relative.match(new RegExp(`^Areas/([^/]+)/${kind}/`, "i"));
  return match?.[1] ?? null;
}

function viewAreaAndController(path: string, root: string): { area: string | null; controller: string | null } {
  const relative = relativeToRoot(path, root);
  const areaMatch = relative.match(/^Areas\/([^/]+)\/Views\/([^/]+)\//i);
  if (areaMatch) return { area: areaMatch[1], controller: areaMatch[2] };
  const rootMatch = relative.match(/^Views\/([^/]+)\//i);
  return { area: null, controller: rootMatch?.[1] ?? null };
}

function uniquePath(candidates: string[], pathsByLower: Map<string, string[]>): {
  path: string | null;
  ambiguous: boolean;
} {
  for (const candidate of candidates) {
    const matches = pathsByLower.get(candidate.toLowerCase()) ?? [];
    if (matches.length === 1) return { path: matches[0], ambiguous: false };
    if (matches.length > 1) return { path: null, ambiguous: true };
  }
  return { path: null, ambiguous: false };
}

function addUniqueDependency(
  dependencies: FrameworkFileDependency[],
  seen: Set<string>,
  dependency: FrameworkFileDependency,
): void {
  const key = `${dependency.sourcePath}\0${dependency.targetPath}\0${dependency.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  dependencies.push(dependency);
}

function addUniqueRelation(
  relations: FrameworkRelation[],
  seen: Set<string>,
  relation: FrameworkRelation,
): void {
  const ref = (value: FrameworkRelation["source"]) =>
    "nodeId" in value ? `id:${value.nodeId}` : `key:${value.nodeKey}`;
  const key = `${ref(relation.source)}\0${ref(relation.target)}\0${relation.edgeType}`;
  if (seen.has(key)) return;
  seen.add(key);
  relations.push(relation);
}

function addCandidate(
  candidates: FrameworkNodeCandidate[],
  byKey: Set<string>,
  candidate: FrameworkNodeCandidate,
): void {
  if (byKey.has(candidate.key)) return;
  byKey.add(candidate.key);
  candidates.push(candidate);
}

async function detectWebProjects(context: FrameworkRelationContext): Promise<WebProject[]> {
  const projects: WebProject[] = [];
  for (const file of context.files) {
    if (!file.path.toLowerCase().endsWith(".csproj")) continue;
    const content = await context.readFile(file.path);
    if (!content) continue;
    const lower = content.toLowerCase();
    if (!ASPNET_KEYWORDS.some((keyword) => lower.includes(keyword))) continue;
    const root = dirname(normalizePath(file.path));
    projects.push({
      projectFile: normalizePath(file.path),
      root,
      files: new Set(
        context.files
          .map((entry) => normalizePath(entry.path))
          .filter((path) => isInRoot(path, root)),
      ),
    });
  }
  projects.sort((a, b) => b.root.length - a.root.length || a.root.localeCompare(b.root));
  return projects;
}

function owningProject(path: string, projects: WebProject[]): WebProject | null {
  return projects.find((project) => isInRoot(path, project.root)) ?? null;
}

async function parseCSharpFiles(
  context: FrameworkRelationContext,
  projects: WebProject[],
): Promise<ParsedCSharpFile[]> {
  const plugin = new TreeSitterPlugin([csharpConfig]);
  await plugin.init();
  const parsed: ParsedCSharpFile[] = [];
  for (const input of context.files) {
    const path = normalizePath(input.path);
    if (!path.toLowerCase().endsWith(".cs") || !owningProject(path, projects)) continue;
    const content = await context.readFile(path);
    if (content === null) continue;
    const analysis = plugin.analyzeFileFull(path, content);
    parsed.push({ path, structure: analysis.structure, calls: analysis.callGraph, content });
  }
  return parsed;
}

function buildIndexes(
  parsedFiles: ParsedCSharpFile[],
  projects: WebProject[],
  stats: Record<string, number>,
  warnings: string[],
): { controllers: ControllerInfo[]; actions: ActionInfo[]; types: TypeInfo[] } {
  const controllers: ControllerInfo[] = [];
  const actions: ActionInfo[] = [];
  const types: TypeInfo[] = [];

  for (const file of parsedFiles) {
    const project = owningProject(file.path, projects);
    if (!project) continue;
    for (const declaration of file.structure.classes) {
      types.push({ project, path: file.path, declaration });
      if (hasAttribute(declaration, "noncontroller")) continue;
      const explicit = hasAttribute(declaration, "controller");
      if (!declaration.name.endsWith("Controller") && !explicit) continue;
      const controllerName = declaration.name.endsWith("Controller")
        ? declaration.name.slice(0, -"Controller".length)
        : declaration.name;
      const classArea = firstAttributeString(declaration, "area");
      const controller: ControllerInfo = {
        project,
        file,
        declaration,
        controllerName,
        classArea,
      };
      controllers.push(controller);
      stats.controllersScanned++;
      if (classArea) stats.areaControllers++;

      const pathValue = pathArea(file.path, project.root, "Controllers");
      if (classArea && pathValue && classArea.toLowerCase() !== pathValue.toLowerCase()) {
        stats.areaPathMismatch++;
        warnings.push(
          `${file.path}: [Area("${classArea}")] conflicts with Areas/${pathValue}/ path`,
        );
      }

      for (const method of file.structure.functions) {
        if (method.kind !== "method") continue;
        if (
          method.lineRange[0] < declaration.lineRange[0]
          || method.lineRange[1] > declaration.lineRange[1]
        ) continue;
        const modifiers = method.modifiers ?? [];
        if (!modifiers.includes("public") || modifiers.includes("static")) continue;
        if (hasAttribute(method, "nonaction")) continue;
        const actionName = firstAttributeString(method, "actionname") ?? method.name;
        const area = firstAttributeString(method, "area") ?? classArea;
        const key = actionKey(project.root, area, controllerName, actionName);
        actions.push({
          controller,
          method,
          actionName,
          area,
          key,
          nodeId: `func:${file.path}:${method.name}`,
        });
        stats.actionsScanned++;
        if (area) stats.areaActions++;
      }
    }
  }

  return { controllers, actions, types };
}

function actionViewCandidates(action: ActionInfo, viewName: string): string[] {
  const root = action.controller.project.root;
  const controller = action.controller.controllerName;
  const area = action.area;
  const withExtension = (path: string) => path.toLowerCase().endsWith(".cshtml")
    ? path
    : `${path}.cshtml`;

  if (viewName.startsWith("~/") || viewName.startsWith("/")) {
    const relative = viewName.startsWith("~/") ? viewName.slice(2) : viewName.slice(1);
    const target = inProject(root, withExtension(relative));
    return target ? [target] : [];
  }

  const base = area
    ? `Areas/${area}/Views/${controller}`
    : `Views/${controller}`;
  if (viewName.startsWith("./") || viewName.startsWith("../")) {
    const target = inProject(root, withExtension(posix.join(base, viewName)));
    return target ? [target] : [];
  }

  const relativeCandidates = area
    ? [
        `Areas/${area}/Views/${controller}/${viewName}.cshtml`,
        `Areas/${area}/Views/Shared/${viewName}.cshtml`,
        `Views/Shared/${viewName}.cshtml`,
      ]
    : [
        `Views/${controller}/${viewName}.cshtml`,
        `Views/Shared/${viewName}.cshtml`,
      ];
  return relativeCandidates
    .map((candidate) => inProject(root, candidate))
    .filter((candidate): candidate is string => candidate !== null);
}

function resolveActionViews(
  actions: ActionInfo[],
  allPaths: Map<string, string[]>,
  customViewLocations: Set<string>,
  nodes: FrameworkNodeCandidate[],
  nodeKeys: Set<string>,
  dependencies: FrameworkFileDependency[],
  dependencyKeys: Set<string>,
  relations: FrameworkRelation[],
  relationKeys: Set<string>,
  stats: Record<string, number>,
): void {
  for (const action of actions) {
    addCandidate(nodes, nodeKeys, {
      key: actionNodeKey(action),
      node: {
        id: action.nodeId,
        type: "function",
        name: action.method.name,
        filePath: action.controller.file.path,
        lineRange: action.method.lineRange,
        summary: `ASP.NET MVC action ${action.controller.controllerName}.${action.actionName}`,
        tags: ["aspnet", "mvc-action"],
        complexity: "simple",
      },
    });

    const calls = action.controller.file.calls.filter((call) =>
      call.callee.split(".").pop() === "View"
      && call.lineNumber >= action.method.lineRange[0]
      && call.lineNumber <= action.method.lineRange[1]);
    for (const call of calls) {
      stats.actionViewCandidates++;
      let viewName = action.actionName;
      if ((call.arguments?.length ?? 0) > 0) {
        const literal = stringLiteral(call.arguments?.[0]);
        if (literal === null) continue;
        viewName = literal;
      }
      const resolved = uniquePath(actionViewCandidates(action, viewName), allPaths);
      if (resolved.ambiguous) {
        stats.actionViewsAmbiguous++;
        continue;
      }
      if (!resolved.path) {
        if (customViewLocations.has(action.controller.project.root)) {
          stats.customViewLocationSkipped++;
        } else {
          stats.actionViewsMissing++;
        }
        continue;
      }
      stats.actionViewsResolved++;
      addUniqueDependency(dependencies, dependencyKeys, {
        sourcePath: action.controller.file.path,
        targetPath: resolved.path,
        kind: "action_view",
        evidence: {
          rule: "aspnet-mvc-view-discovery",
          filePath: action.controller.file.path,
          lineRange: [call.lineNumber, call.lineNumber],
        },
      });
      addUniqueRelation(relations, relationKeys, {
        kind: "action_view",
        source: { nodeKey: actionNodeKey(action) },
        target: { nodeId: `file:${resolved.path}` },
        edgeType: "depends_on",
        weight: 1,
        evidence: {
          rule: "aspnet-mvc-view-discovery",
          filePath: action.controller.file.path,
          lineRange: [call.lineNumber, call.lineNumber],
        },
      });
    }
  }
}

function typeTokens(typeExpression: string): string[] {
  const tokens = typeExpression.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? [];
  const ignored = new Set([
    "global", "System", "Collections", "Generic", "IEnumerable", "IList", "List",
    "ICollection", "Task", "Nullable", "Dictionary", "string", "int", "bool",
    "long", "short", "byte", "decimal", "double", "float", "object", "dynamic",
  ]);
  return [...new Set(tokens.filter((token) => !ignored.has(token)))];
}

function ancestorImports(
  viewPath: string,
  project: WebProject,
  razorContents: Map<string, string>,
): string[] {
  const imports: string[] = [];
  let current = dirname(viewPath);
  while (isInRoot(current, project.root)) {
    const importsPath = current ? `${current}/_ViewImports.cshtml` : "_ViewImports.cshtml";
    const content = razorContents.get(importsPath);
    if (content) {
      for (const match of content.matchAll(/^\s*@using\s+([A-Za-z_][A-Za-z0-9_.]*)/gm)) {
        imports.push(match[1]);
      }
    }
    if (current === project.root || current === "") break;
    current = dirname(current);
  }
  return [...new Set(imports)];
}

function resolveType(
  token: string,
  project: WebProject,
  imports: string[],
  types: TypeInfo[],
): { value: TypeInfo | null; ambiguous: boolean; crossProject: boolean } {
  const localTypes = types.filter((type) => type.project === project);
  const simpleName = token.split(".").pop() ?? token;
  let matches: TypeInfo[];
  if (token.includes(".")) {
    matches = localTypes.filter((type) => type.declaration.fullName === token);
  } else {
    const importedNames = new Set(imports.map((namespace) => `${namespace}.${token}`));
    matches = localTypes.filter((type) =>
      importedNames.has(type.declaration.fullName ?? "")
      || (imports.length === 0 && type.declaration.name === token));
    if (matches.length === 0) {
      const simpleMatches = localTypes.filter((type) => type.declaration.name === token);
      if (simpleMatches.length === 1) matches = simpleMatches;
    }
  }
  if (matches.length === 1) return { value: matches[0], ambiguous: false, crossProject: false };
  if (matches.length > 1) return { value: null, ambiguous: true, crossProject: false };
  const elsewhere = types.some((type) =>
    type.project !== project
    && (type.declaration.fullName === token || type.declaration.name === simpleName));
  return { value: null, ambiguous: false, crossProject: elsewhere };
}

async function resolveRazorTypes(
  context: FrameworkRelationContext,
  projects: WebProject[],
  types: TypeInfo[],
  dependencies: FrameworkFileDependency[],
  dependencyKeys: Set<string>,
  relations: FrameworkRelation[],
  relationKeys: Set<string>,
  stats: Record<string, number>,
): Promise<Map<string, string>> {
  const razorContents = new Map<string, string>();
  for (const file of context.files) {
    const path = normalizePath(file.path);
    if (!path.toLowerCase().endsWith(".cshtml") || !owningProject(path, projects)) continue;
    const content = await context.readFile(path);
    if (content !== null) razorContents.set(path, content);
  }

  for (const [path, content] of razorContents) {
    if (/^\s*@page\b/m.test(content)) continue;
    const project = owningProject(path, projects);
    if (!project || path.toLowerCase().endsWith("/_viewimports.cshtml")) continue;
    stats.razorViewsScanned++;
    const imports = ancestorImports(path, project, razorContents);
    const directives: Array<{ kind: "model" | "inject"; type: string; index: number }> = [];
    for (const match of content.matchAll(/^\s*@model\s+([^\r\n]+)/gm)) {
      directives.push({ kind: "model", type: match[1].trim(), index: match.index ?? 0 });
    }
    for (const match of content.matchAll(/^\s*@inject\s+([^\s]+)\s+[A-Za-z_][A-Za-z0-9_]*/gm)) {
      directives.push({ kind: "inject", type: match[1].trim(), index: match.index ?? 0 });
    }

    for (const directive of directives) {
      for (const token of typeTokens(directive.type)) {
        const resolved = resolveType(token, project, imports, types);
        if (resolved.ambiguous) {
          if (directive.kind === "model") stats.razorModelsAmbiguous++;
          continue;
        }
        if (resolved.crossProject) {
          stats.crossProjectSkipped++;
          continue;
        }
        if (!resolved.value) continue;
        if (directive.kind === "model") stats.razorModelsResolved++;
        else stats.razorInjectsResolved++;
        const line = lineOf(content, directive.index);
        const kind = directive.kind === "model" ? "view_model" : "view_inject";
        addUniqueDependency(dependencies, dependencyKeys, {
          sourcePath: path,
          targetPath: resolved.value.path,
          kind,
          evidence: { rule: `razor-${directive.kind}`, filePath: path, lineRange: [line, line] },
        });
        addUniqueRelation(relations, relationKeys, {
          kind,
          source: { nodeId: `file:${path}` },
          target: {
            nodeId: `class:${resolved.value.path}:${resolved.value.declaration.name}`,
          },
          edgeType: "depends_on",
          weight: 1,
          evidence: { rule: `razor-${directive.kind}`, filePath: path, lineRange: [line, line] },
        });
      }
    }
  }
  return razorContents;
}

function joinRoute(prefix: string, template: string): string {
  const joined = [prefix, template]
    .filter(Boolean)
    .join("/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");
  return `/${joined}`;
}

function routeTemplates(value: { attributes?: AttributeInfo[] }, name: string): string[] {
  return findAttributes(value, name)
    .map((attribute) => stringLiteral(attribute.arguments[0]))
    .filter((template): template is string => template !== null);
}

function resolveRouteTokens(template: string, action: ActionInfo): string | null {
  const values: Record<string, string | null> = {
    area: action.area,
    controller: action.controller.controllerName,
    action: action.actionName,
  };
  let unresolved = false;
  const result = template.replace(/\[(area|controller|action)\]/gi, (_, token: string) => {
    const value = values[token.toLowerCase()];
    if (value === null) {
      unresolved = true;
      return "";
    }
    return value;
  });
  return unresolved ? null : result;
}

function resolveAttributeRoutes(
  actions: ActionInfo[],
  nodes: FrameworkNodeCandidate[],
  nodeKeys: Set<string>,
  relations: FrameworkRelation[],
  relationKeys: Set<string>,
  stats: Record<string, number>,
): void {
  for (const action of actions) {
    const controllerRoutes = routeTemplates(action.controller.declaration, "route");
    const methodRoutes = routeTemplates(action.method, "route");
    const httpAttributes = attributes(action.method)
      .map((attribute) => ({
        verb: HTTP_ATTRIBUTES[normalizedAttributeName(attribute)],
        template: stringLiteral(attribute.arguments[0]),
      }))
      .filter((entry) => entry.verb);
    const routeEntries: Array<{ verb: string; template: string }> = [];

    if (httpAttributes.length > 0) {
      for (const http of httpAttributes) {
        const templates = http.template !== null
          ? [http.template]
          : methodRoutes.length > 0 ? methodRoutes : [""];
        for (const prefix of controllerRoutes.length ? controllerRoutes : [""]) {
          for (const template of templates) routeEntries.push({ verb: http.verb, template: joinRoute(prefix, template) });
        }
      }
    } else {
      for (const prefix of controllerRoutes.length ? controllerRoutes : [""]) {
        for (const template of methodRoutes) routeEntries.push({ verb: "ANY", template: joinRoute(prefix, template) });
      }
    }

    for (const route of routeEntries) {
      const path = resolveRouteTokens(route.template, action);
      if (!path) continue;
      const name = `${route.verb} ${path}`;
      const key = `aspnet:endpoint:${action.controller.project.root || "."}:${name}`;
      addCandidate(nodes, nodeKeys, {
        key,
        node: {
          id: `endpoint:${action.controller.project.root || "."}:${name}`,
          type: "endpoint",
          name,
          filePath: action.controller.file.path,
          lineRange: action.method.lineRange,
          summary: `ASP.NET attribute route ${name}`,
          tags: ["aspnet", "http-endpoint"],
          complexity: "simple",
        },
      });
      addUniqueRelation(relations, relationKeys, {
        kind: "route_handler",
        source: { nodeKey: key },
        target: { nodeKey: actionNodeKey(action) },
        edgeType: "routes",
        weight: 1,
        evidence: {
          rule: "aspnet-attribute-route",
          filePath: action.controller.file.path,
          lineRange: action.method.lineRange,
        },
      });
      stats.attributeRoutesResolved++;
    }
  }
}

function observeConventionalRoutes(parsedFiles: ParsedCSharpFile[], stats: Record<string, number>): void {
  for (const file of parsedFiles) {
    stats.conventionalRoutesObserved += (
      file.content.match(/\bMap(?:Area)?ControllerRoute\s*\(/g) ?? []
    ).length;
  }
}

function resolveTagHelpers(
  razorContents: Map<string, string>,
  projects: WebProject[],
  actionsByKey: Map<string, ActionInfo[]>,
  relations: FrameworkRelation[],
  relationKeys: Set<string>,
  stats: Record<string, number>,
): void {
  for (const [path, content] of razorContents) {
    if (/^\s*@page\b/m.test(content)) continue;
    const project = owningProject(path, projects);
    if (!project) continue;
    const ambient = viewAreaAndController(path, project.root).area;
    for (const match of content.matchAll(/<a\b[^>]*>/gi)) {
      const tag = match[0];
      const attrs = new Map<string, string>();
      for (const attr of tag.matchAll(/\b(asp-area|asp-controller|asp-action)\s*=\s*(["'])(.*?)\2/gi)) {
        attrs.set(attr[1].toLowerCase(), attr[3]);
      }
      const controller = attrs.get("asp-controller");
      const action = attrs.get("asp-action");
      if (!controller || !action) continue;
      const explicitArea = attrs.get("asp-area");
      const area = explicitArea === undefined ? ambient : explicitArea || null;
      if ([explicitArea, controller, action].some((value) => value?.includes("@"))) continue;
      const key = actionKey(project.root, area, controller, action);
      const matches = actionsByKey.get(key) ?? [];
      if (matches.length !== 1) {
        if (matches.length > 1) stats.tagHelperLinksAmbiguous++;
        continue;
      }
      const line = lineOf(content, match.index ?? 0);
      addUniqueRelation(relations, relationKeys, {
        kind: "template_link",
        source: { nodeId: `file:${path}` },
        target: { nodeKey: actionNodeKey(matches[0]) },
        edgeType: "routes",
        weight: 1,
        evidence: { rule: "razor-anchor-tag-helper", filePath: path, lineRange: [line, line] },
      });
      stats.tagHelperLinksResolved++;
    }
  }
}

export const aspnetProvider: FrameworkRelationProvider = {
  frameworkId: "aspnet",

  async analyze(context): Promise<FrameworkRelationResult> {
    const stats: Record<string, number> = { ...EMPTY_STATS };
    const warnings: string[] = [];
    const fileDependencies: FrameworkFileDependency[] = [];
    const nodes: FrameworkNodeCandidate[] = [];
    const relations: FrameworkRelation[] = [];
    const dependencyKeys = new Set<string>();
    const nodeKeys = new Set<string>();
    const relationKeys = new Set<string>();

    const projects = await detectWebProjects(context);
    stats.webProjectsDetected = projects.length;
    if (projects.length === 0) {
      return { fileDependencies, nodes, relations, stats, warnings };
    }

    const parsedFiles = await parseCSharpFiles(context, projects);
    const { actions, types } = buildIndexes(parsedFiles, projects, stats, warnings);
    const pathsByLower = new Map<string, string[]>();
    for (const file of context.files) {
      const path = normalizePath(file.path);
      const key = path.toLowerCase();
      pathsByLower.set(key, [...(pathsByLower.get(key) ?? []), path]);
    }
    const customViewLocations = new Set<string>();
    for (const file of parsedFiles) {
      if (/\b(?:ViewLocationFormats|AreaViewLocationFormats|IViewLocationExpander)\b/.test(file.content)) {
        const project = owningProject(file.path, projects);
        if (project) customViewLocations.add(project.root);
      }
    }

    resolveActionViews(
      actions,
      pathsByLower,
      customViewLocations,
      nodes,
      nodeKeys,
      fileDependencies,
      dependencyKeys,
      relations,
      relationKeys,
      stats,
    );
    const razorContents = await resolveRazorTypes(
      context,
      projects,
      types,
      fileDependencies,
      dependencyKeys,
      relations,
      relationKeys,
      stats,
    );
    resolveAttributeRoutes(actions, nodes, nodeKeys, relations, relationKeys, stats);
    observeConventionalRoutes(parsedFiles, stats);
    const actionsByKey = new Map<string, ActionInfo[]>();
    for (const action of actions) {
      actionsByKey.set(action.key, [...(actionsByKey.get(action.key) ?? []), action]);
    }
    resolveTagHelpers(razorContents, projects, actionsByKey, relations, relationKeys, stats);

    return { fileDependencies, nodes, relations, stats, warnings };
  },
};
