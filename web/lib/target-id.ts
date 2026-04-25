// Canonical stable IDs for the Phase 4 social layer (votes, comments, annotations).
// Generate from YAML; never store object references in the DB.
//
// Format: "domain:<domainId>/<kind>:<id>"
// Examples:
//   domain:classification/table:KSSK
//   domain:classification/relationship:ksml_to_klah
//   domain:classification/source:src_classification_v1b_2014

export type TargetKind = "table" | "relationship" | "source" | "annotation";

export function targetId(
  domainId: string,
  kind: TargetKind,
  id: string,
): string {
  return `domain:${domainId}/${kind}:${id}`;
}
