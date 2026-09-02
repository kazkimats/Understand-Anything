export interface SemanticProjectFacts {
  projectFile: string;
  compilationSucceeded: boolean;
  targetFrameworks: string[];
  references: string[];
  referencesResolved?: boolean;
}

export interface SemanticBaseTypeFacts {
  symbolName: string;
  kind: string;
  resolvedOutsideProject: boolean;
}

export interface SemanticAttributeFacts {
  symbolName: string;
  arguments: string[];
}

export interface SemanticTypeFacts {
  projectFile: string;
  symbolName: string;
  kind: string;
  filePath: string;
  lineRange: [number, number];
  baseTypes: SemanticBaseTypeFacts[];
  attributes: SemanticAttributeFacts[];
}

export interface SemanticMethodFacts {
  projectFile: string;
  containingType: string;
  methodName: string;
  kind: string;
  filePath: string;
  lineRange: [number, number];
  modifiers: string[];
  isConstructor: boolean;
  attributes: SemanticAttributeFacts[];
}

export type SemanticInvocationTargetKind =
  | "instance-method"
  | "static"
  | "extension"
  | "unresolvable";

export interface SemanticInvocationFacts {
  projectFile: string;
  containingType: string;
  containingMethod: string;
  invocationName: string;
  symbolName: string;
  filePath: string;
  lineRange: [number, number];
  arguments: string[];
  targetKind: SemanticInvocationTargetKind;
  resolved: boolean;
}

export interface CSharpSemanticFacts {
  schemaVersion: 1;
  projects: SemanticProjectFacts[];
  types: SemanticTypeFacts[];
  methods: SemanticMethodFacts[];
  invocations: SemanticInvocationFacts[];
  diagnostics: string[];
  warnings: string[];
}
