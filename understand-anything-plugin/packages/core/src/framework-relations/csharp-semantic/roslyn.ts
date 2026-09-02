import { z } from "zod";
import type { CSharpSemanticFacts } from "./facts.js";

const LineRangeSchema = z.tuple([z.number().int().positive(), z.number().int().positive()]);

const AttributeSchema = z.object({
  symbolName: z.string(),
  arguments: z.array(z.string()),
});

const ProjectFactsSchema = z.object({
    projectFile: z.string().min(1),
    compilationSucceeded: z.boolean(),
    targetFrameworks: z.array(z.string()),
    references: z.array(z.string()),
    referencesResolved: z.boolean().optional(),
});

const TypeFactsSchema = z.object({
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
});

const MethodFactsSchema = z.object({
    projectFile: z.string().min(1),
    containingType: z.string().min(1),
    methodName: z.string().min(1),
    kind: z.string().min(1),
    filePath: z.string().min(1),
    lineRange: LineRangeSchema,
    modifiers: z.array(z.string()),
    isConstructor: z.boolean(),
    attributes: z.array(AttributeSchema),
});

const InvocationFactsSchema = z.object({
    projectFile: z.string().min(1),
    containingType: z.string().min(1),
    containingMethod: z.string(),
    invocationName: z.string().min(1),
    symbolName: z.string(),
    filePath: z.string().min(1),
    lineRange: LineRangeSchema,
    arguments: z.array(z.string()),
    targetKind: z.enum(["instance-method", "static", "extension", "unresolvable"])
      .catch("unresolvable"),
    resolved: z.boolean(),
});

const CSharpSemanticFactsEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  projects: z.array(ProjectFactsSchema),
  types: z.array(z.unknown()),
  methods: z.array(z.unknown()),
  invocations: z.array(z.unknown()),
  diagnostics: z.array(z.string()),
  warnings: z.array(z.string()),
});

function validRecords<T>(records: unknown[], schema: z.ZodType<T>): { values: T[]; dropped: number } {
  const values: T[] = [];
  let dropped = 0;
  for (const record of records) {
    const parsed = schema.safeParse(record);
    if (parsed.success) values.push(parsed.data);
    else dropped++;
  }
  return { values, dropped };
}

export const CSharpSemanticFactsSchema = CSharpSemanticFactsEnvelopeSchema.transform((facts) => {
  const types = validRecords(facts.types, TypeFactsSchema);
  const methods = validRecords(facts.methods, MethodFactsSchema);
  const invocations = validRecords(facts.invocations, InvocationFactsSchema);
  const dropped = types.dropped + methods.dropped + invocations.dropped;
  const warnings = [...facts.warnings];
  if (dropped > 0) {
    warnings.push(
      `${dropped} malformed semantic-facts records were dropped `
      + `(types: ${types.dropped}, methods: ${methods.dropped}, invocations: ${invocations.dropped})`,
    );
  }
  return {
    ...facts,
    types: types.values,
    methods: methods.values,
    invocations: invocations.values,
    warnings,
  };
});

export function parseCSharpSemanticFacts(value: unknown): CSharpSemanticFacts {
  return CSharpSemanticFactsSchema.parse(value) as CSharpSemanticFacts;
}

export function parseCSharpSemanticFactsJson(json: string): CSharpSemanticFacts {
  return parseCSharpSemanticFacts(JSON.parse(json));
}
