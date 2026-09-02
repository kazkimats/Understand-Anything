export {
  FrameworkRelationArtifactSchema,
  validateFrameworkRelationArtifact,
} from "./types.js";
export type {
  ProjectFile,
  FrameworkStructuralAnalysis,
  FrameworkRelationContext,
  FrameworkFileDependency,
  FrameworkEvidence,
  FrameworkNodeCandidate,
  FrameworkNodeReference,
  FrameworkRelation,
  FrameworkRelationResult,
  FrameworkRelationArtifact,
  FrameworkRelationProvider,
} from "./types.js";
export {
  FrameworkRelationRegistry,
  runFrameworkRelationProviders,
} from "./registry.js";
export { aspnetProvider } from "./providers/index.js";
export type {
  FrameworkProviderRunStats,
  FrameworkProviderRunResult,
} from "./registry.js";
