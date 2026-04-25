// Hand-derived from /schema.json (v0.2). Update in lockstep with schema changes.
// Bumping format_version implies updating these types.

export interface DomainFile {
  domain: DomainMeta;
  sources?: Source[];
  tables: Table[];
  relationships: Relationship[];
  extraction_queries?: ExtractionQuery[];
  cross_references?: CrossReference[];
}

export interface DomainMeta {
  id: string;
  name: string;
  sap_module?: string;
  description?: string;
}

export type SourceType =
  | "pdf"
  | "web"
  | "internal_doc"
  | "field_observation"
  | "sap_help"
  | "consultant_input";

export interface Source {
  id: string;
  type: SourceType;
  title: string;
  path?: string;
  url?: string;
  date?: string;
  notes?: string;
}

export type Severity = "low" | "medium" | "high";

export interface Annotation {
  text: string;
  severity?: Severity;
  source?: string;
}

export interface Layout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface Field {
  name: string;
  description?: string;
  data_element?: string;
  length?: number;
}

export interface Table {
  id: string;
  name: string;
  cluster: string;
  text_table?: string;
  description?: string;
  key_fields?: string[];
  fields?: Field[];
  notes?: string;
  gotchas?: Annotation[];
  s4_changes?: Annotation[];
  layout?: Layout;
}

export interface RelationshipEndpoint {
  table: string;
  fields: string[];
}

export type Cardinality =
  | "one_to_one"
  | "one_to_many"
  | "many_to_one"
  | "many_to_many";

export interface RelationshipSimple {
  id: string;
  type?: "simple";
  description?: string;
  from: RelationshipEndpoint;
  to: RelationshipEndpoint;
  cardinality?: Cardinality;
  optional?: boolean;
  conditions?: Record<string, unknown>;
  sql_example?: string;
}

export interface ObjectResolution {
  klart?: string;
  discriminator?: Record<string, unknown>;
  target_table: string;
  objek_format?: string;
  via_inob?: boolean;
  notes?: string;
}

export interface SqlExample {
  title: string;
  body: string;
}

export interface RelationshipPolymorphic {
  id: string;
  type: "polymorphic";
  description?: string;
  from: RelationshipEndpoint;
  object_resolution: ObjectResolution[];
  sql_examples?: SqlExample[];
}

export type Relationship = RelationshipSimple | RelationshipPolymorphic;

export function isPolymorphic(
  rel: Relationship,
): rel is RelationshipPolymorphic {
  return rel.type === "polymorphic";
}

export interface ExtractionQuery {
  id: string;
  description?: string;
  sql: string;
}

export interface CrossReference {
  target_domain: string;
  via_table?: string;
  notes?: string;
}

// clusters.yaml
export interface ClusterRegistry {
  clusters: Cluster[];
}

export interface Cluster {
  id: string;
  name: string;
  color: string;
  description?: string;
}
