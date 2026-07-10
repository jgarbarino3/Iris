export type DiagnosticStatusV1 = 'ok' | 'degraded' | 'broken';
export type DiagnosticRequirednessV1 = 'required' | 'conditional';
export type DiagnosticCategoryV1 =
  | 'host'
  | 'transport'
  | 'runtime'
  | 'browser'
  | 'bridge'
  | 'project'
  | 'file'
  | 'editor';

export type DiagnosticRepairV1 = {
  kind: 'manual' | 'command';
  summary: string;
  command?: string;
  scope: 'local-safe';
};

export type DiagnosticCheckV1 = {
  schemaVersion: 1;
  id: string;
  category: DiagnosticCategoryV1;
  requiredness: DiagnosticRequirednessV1;
  status: DiagnosticStatusV1;
  summary: string;
  evidence: string[];
  repair?: DiagnosticRepairV1;
  checkedAt: string;
};

export type DiagnosticReportV1 = {
  schemaVersion: 1;
  generatedAt: string;
  overallStatus: DiagnosticStatusV1;
  checks: DiagnosticCheckV1[];
};
