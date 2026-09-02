import { z } from "zod";
import type { CSharpSemanticFacts } from "./facts.js";

const LineRangeSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]);

const AttributeSchema = z.object({
  symbolName: z.string(),
  arguments: z.array(z.string()),
});

export const CSharpSemanticFactsSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(z.object({
    projectFile: z.string().min(1),
    compilationSucceeded: z.boolean(),
    targetFrameworks: z.array(z.string()),
    references: z.array(z.string()),
    referencesResolved: z.boolean().optional(),
  })),
  types: z.array(z.object({
    projectFile: z.string().min(1),
    symbolName: z.string().min(1),
    kind: z.string().min(1),
    filePath: z.string().min(1),
    lineRange: LineRangeSchema,
    baseTypes: z.array(z.object({
      symbolName: z.string().min(1),
      kind: z.string().min(1),
      resolvedOutsideProject: z.boolean(),
    })),
    attributes: z.array(AttributeSchema),
  })),
  methods: z.array(z.object({
    projectFile: z.string().min(1),
    containingType: z.string().min(1),
    methodName: z.string().min(1),
    kind: z.string().min(1),
    filePath: z.string().min(1),
    lineRange: LineRangeSchema,
    modifiers: z.array(z.string()),
    isConstructor: z.boolean(),
    attributes: z.array(AttributeSchema),
  })),
  invocations: z.array(z.object({
    projectFile: z.string().min(1),
    containingType: z.string().min(1),
    containingMethod: z.string().min(1),
    invocationName: z.string().min(1),
    symbolName: z.string(),
    filePath: z.string().min(1),
    lineRange: LineRangeSchema,
    arguments: z.array(z.string()),
    targetKind: z.enum(["instance-method", "static", "extension", "unresolvable"]),
    resolved: z.boolean(),
  })),
  diagnostics: z.array(z.string()),
  warnings: z.array(z.string()),
});

export function parseCSharpSemanticFacts(value: unknown): CSharpSemanticFacts {
  return CSharpSemanticFactsSchema.parse(value) as CSharpSemanticFacts;
}

export function parseCSharpSemanticFactsJson(json: string): CSharpSemanticFacts {
  return parseCSharpSemanticFacts(JSON.parse(json));
}
