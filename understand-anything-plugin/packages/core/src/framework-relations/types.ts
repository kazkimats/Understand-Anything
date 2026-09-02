import { z } from "zod";
import { EdgeTypeSchema, GraphNodeSchema } from "../schema.js";
import type { EdgeType, NodeType, StructuralAnalysis } from "../types.js";
import type { FrameworkConfig } from "../languages/types.js";

export interface ProjectFile {
  path: string;
  language: string;
  sizeLines?: number;
  fileCategory?: string;
}

export interface FrameworkStructuralAnalysis extends StructuralAnalysis {
  filePath: string;
}

export interface FrameworkRelationContext {
  projectRoot: string;
  framework: FrameworkConfig;
  files: ProjectFile[];
  changedFiles?: string[];
  extractionResults?: FrameworkStructuralAnalysis[];
  readFile(path: string): Promise<string | null>;
}

export interface FrameworkFileDependency {
  sourcePath: string;
  targetPath: string;
  kind: string;
  evidence?: FrameworkEvidence;
}

export interface FrameworkEvidence {
  rule: string;
  filePath?: string;
  lineRange?: [number, number];
}

export interface FrameworkNodeCandidate {
  key: string;
  node: {
    id: string;
    type: NodeType;
    name: string;
    filePath: string;
    lineRange?: [number, number];
    summary: string;
    tags: string[];
    complexity: "simple" | "moderate" | "complex";
  };
}

export type FrameworkNodeReference = { nodeId: string } | { nodeKey: string };

export interface FrameworkRelation {
  kind: string;
  source: FrameworkNodeReference;
  target: FrameworkNodeReference;
  edgeType: EdgeType;
  weight?: number;
  evidence?: FrameworkEvidence;
}

export interface FrameworkRelationResult {
  fileDependencies: FrameworkFileDependency[];
  nodes: FrameworkNodeCandidate[];
  relations: FrameworkRelation[];
  stats: Record<string, number>;
  warnings: string[];
}

export interface FrameworkRelationArtifact extends FrameworkRelationResult {
  schemaVersion: 1;
  frameworkId: string;
}

export interface FrameworkRelationProvider {
  readonly frameworkId: string;
  analyze(context: FrameworkRelationContext): Promise<FrameworkRelationResult>;
}

const EvidenceSchema = z.object({
  rule: z.string().min(1),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
});

const NodeReferenceSchema = z.union([
  z.object({ nodeId: z.string().min(1) }).strict(),
  z.object({ nodeKey: z.string().min(1) }).strict(),
]);

export const FrameworkRelationArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  frameworkId: z.string().min(1),
  fileDependencies: z.array(z.object({
    sourcePath: z.string().min(1),
    targetPath: z.string().min(1),
    kind: z.string().min(1),
    evidence: EvidenceSchema.optional(),
  })),
  nodes: z.array(z.object({
    key: z.string().min(1),
    node: GraphNodeSchema.extend({ filePath: z.string().min(1) }),
  })),
  relations: z.array(z.object({
    kind: z.string().min(1),
    source: NodeReferenceSchema,
    target: NodeReferenceSchema,
    edgeType: EdgeTypeSchema,
    weight: z.number().min(0).max(1).optional(),
    evidence: EvidenceSchema.optional(),
  })),
  stats: z.record(z.string(), z.number()),
  warnings: z.array(z.string()),
});

export function validateFrameworkRelationArtifact(
  artifact: unknown,
): FrameworkRelationArtifact {
  return FrameworkRelationArtifactSchema.parse(artifact) as FrameworkRelationArtifact;
}
