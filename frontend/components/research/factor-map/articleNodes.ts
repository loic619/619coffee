// Which factor-map nodes each research article bears on.
//
// Lives beside the node table on purpose: the map, its coordinates and this
// mapping are one object. Add a factor to nodes.ts and it renders in the
// Differential note's figure AND in the research map view with no second
// edit; point research at it here and the badge appears in both places too.
//
// Rule-based for now — the kicker's topic prefix picks the nodes, with explicit
// pins where the topic is too coarse to be useful. Hand-curation per article is
// the obvious refinement; the rules keep every article placed in the meantime
// rather than leaving most of the map empty.
import type { Article } from "@/lib/research/catalog";

export const TOPIC_NODES: Record<string, string[]> = {
  "COT":              ["pos_analysis", "id_counter", "funds_motiv"],
  "Signals":          ["futures", "pos_analysis"],
  "Options":          ["opt_curve", "nondir", "pos_likely"],
  "Futures":          ["structure", "futures"],
  "Macro":            ["macro", "ecy_icy", "purch_power"],
  "Weather":          ["weather", "tree_yield", "early_dry"],
  "Agronomy":         ["tree_yield", "tree_density", "conversion"],
  "Fertilizer":       ["fertilizer", "cost_prod"],
  "Supply":           ["supply", "crop"],
  "Farmer economics": ["cost_prod", "farm_price", "farm_finance"],
  "Logistics":        ["logistic", "warehouse", "afloat"],
  "Freight":          ["logistic", "afloat"],
  "Exchange":         ["stocks_vol", "motiv_grade", "tender_par"],
  "Contract rules":   ["new_rule", "pos_limit", "motiv_grade"],
  "Basis":            ["differential", "prem_disc"],
  "Differential":     ["differential"],
  "Demand":           ["demand", "consumption", "cup_capita"],
};

/** Per-article overrides, where the topic rule lands too broadly. */
export const PINS: Record<string, string[]> = {
  "the-optionization-ratio-coffee-s-risk-is-moving-into": ["oi_repart", "opt_curve"],
  "oi-walls-where-the-strike-matrix-defends-a-level":     ["oi_repart", "pos_limit"],
  "tender-parity-tool":                                   ["tender_par", "differential"],
  "the-conilon-reference-stack-cooabriel-cepea-vit-ria-a": ["differential", "origin_stock"],
};

export function nodesForArticle(a: Article): string[] {
  if (PINS[a.id]) return PINS[a.id];
  const topic = (a.kicker ?? "").split("·")[0].trim();
  return TOPIC_NODES[topic] ?? [];
}
